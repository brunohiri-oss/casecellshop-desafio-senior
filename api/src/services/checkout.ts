import { createHash, randomUUID } from 'node:crypto';
import { env } from '../config/env.js';
import { withTx } from '../infra/db.js';
import { checkoutQueue, CHECKOUT_QUEUE } from '../infra/queue.js';
import { logger } from '../observability/logger.js';
import {
  checkoutStarted,
  checkoutDuration,
  checkoutIdempotencyReplays,
  stockReserveConflicts,
} from '../observability/metrics.js';
import { withSpan, injectContext } from '../observability/tracing.js';
import {
  claimIdempotencyKey,
  completeIdempotencyTx,
  completeIdempotency,
  releaseIdempotencyOnError,
  type IdempotencyRow,
} from '../repositories/idempotency.js';
import type { ReserveResult } from '../repositories/stock.js';
import { insertOrderTx } from '../repositories/orders.js';
import { insertOutboxEventTx, markOutboxPublished } from '../repositories/outbox.js';
import { reserveStockTx, type CheckoutItem } from '../repositories/stock.js';

export interface CheckoutInput {
  idempotencyKey: string;
  items: CheckoutItem[];
  correlationId: string;
}

export type CheckoutResult =
  | { kind: 'accepted'; orderId: string; status: 'pending'; replay: boolean }
  | {
      kind: 'rejected';
      code: 'insufficient_stock' | 'unknown_sku';
      sku: string;
      httpStatus: 409;
    }
  | { kind: 'in_progress'; httpStatus: 409 }
  | { kind: 'hash_mismatch'; httpStatus: 422 };

function hashBody(items: CheckoutItem[]): string {
  const normalized = items
    .map((i) => ({ sku: i.sku, quantity: i.quantity }))
    .sort((a, b) => a.sku.localeCompare(b.sku));
  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}

class InsufficientStockError extends Error {
  constructor(public readonly reason: 'insufficient_stock' | 'unknown_sku', public readonly sku: string) {
    super(`cannot fulfill sku ${sku}: ${reason}`);
    this.name = 'InsufficientStockError';
  }
}

export async function processCheckout(input: CheckoutInput): Promise<CheckoutResult> {
  return withSpan(
    'checkout.process',
    {
      'idempotency.key': input.idempotencyKey,
      'correlation.id': input.correlationId,
      'checkout.item_count': input.items.length,
    },
    async (rootSpan) => {
      const log = logger.child({
        correlationId: input.correlationId,
        idempotencyKey: input.idempotencyKey,
      });
      const requestHash = hashBody(input.items);

      // 1. Idempotência — claim ou replay
      const claim = await withSpan(
        'idempotency.claim',
        { 'idempotency.key': input.idempotencyKey },
        async (span) => {
          const c = await claimIdempotencyKey({
            key: input.idempotencyKey,
            requestHash,
            ttlHours: env.IDEMPOTENCY_TTL_HOURS,
          });
          span.setAttribute('idempotency.outcome', c.outcome);
          return c;
        }
      );

      rootSpan.setAttribute('idempotency.outcome', claim.outcome);

      if (claim.outcome === 'replay') {
        checkoutIdempotencyReplays.inc();
        log.info({ orderId: claim.existing.order_id }, 'idempotency replay');
        return replayResult(claim.existing);
      }
      if (claim.outcome === 'hash_mismatch') {
        log.warn('idempotency hash mismatch');
        return { kind: 'hash_mismatch', httpStatus: 422 };
      }
      if (claim.outcome === 'in_progress') {
        log.info('idempotent request still in progress');
        return { kind: 'in_progress', httpStatus: 409 };
      }

      // 2. Claimed — processar de fato.
      const orderId = randomUUID();
      rootSpan.setAttribute('order.id', orderId);

      let txResult: { orderId: string; outboxId: string };
      try {
        txResult = await withSpan('checkout.tx', { 'order.id': orderId }, () =>
          withTx(async (client) => {
            const reserveStart = Date.now();
            const reserve: ReserveResult = await withSpan(
              'stock.reserve',
              { 'order.id': orderId },
              () => reserveStockTx(client, input.items)
            );
            checkoutDuration
              .labels({ phase: 'reserve_stock' })
              .observe((Date.now() - reserveStart) / 1000);

            // CRÍTICO: ao falhar a reserva, LANÇAMOS exceção para forçar ROLLBACK.
            // Retornar { kind: 'rejected' } daqui faria withTx COMMITAR, deixando
            // decrementos parciais persistidos em ordens multi-item.
            if (!reserve.ok) {
              throw new InsufficientStockError(reserve.reason, reserve.sku);
            }

            await insertOrderTx(client, {
              id: orderId,
              items: input.items,
              idempotencyKey: input.idempotencyKey,
            });

            const outboxId = await insertOutboxEventTx(client, {
              eventType: 'checkout.requested',
              payload: { orderId, items: input.items, correlationId: input.correlationId },
            });

            const responseBody = { orderId, status: 'pending' };
            await completeIdempotencyTx(client, {
              key: input.idempotencyKey,
              orderId,
              responseBody,
              responseCode: 202,
            });
            return { orderId, outboxId };
          })
        );
      } catch (err) {
        if (err instanceof InsufficientStockError) {
          // Tx foi rolled back — estoque restaurado.
          // Agora persistimos a falha na tabela de idempotência em tx separada,
          // para que replay retorne 409 sem reprocessar.
          stockReserveConflicts.labels({ sku: err.sku }).inc();
          rootSpan.setAttribute('checkout.outcome', `rejected_${err.reason}`);
          rootSpan.setAttribute('stock.failed_sku', err.sku);
          const body = { code: err.reason, message: err.message, sku: err.sku };
          await completeIdempotency({
            key: input.idempotencyKey,
            orderId: null,
            responseBody: body,
            responseCode: 409,
          });
          return { kind: 'rejected', code: err.reason, sku: err.sku, httpStatus: 409 };
        }
        log.error({ err }, 'checkout processing failed; releasing idempotency key');
        await releaseIdempotencyOnError(input.idempotencyKey);
        throw err;
      }

      // 3. Pós-commit: enfileira job. Se falhar, evento fica no outbox como 'pending'
      //    e seria reprocessado por um outbox publisher (não implementado neste escopo).
      const enqueueStart = Date.now();
      await withSpan('queue.enqueue', { 'queue.name': CHECKOUT_QUEUE, 'order.id': orderId }, async () => {
        try {
          await checkoutQueue.add(
            'checkout',
            {
              orderId: txResult.orderId,
              items: input.items,
              correlationId: input.correlationId,
              _otel: injectContext(),
            },
            { jobId: txResult.orderId } // jobId = orderId garante idempotência no enqueue
          );
          await markOutboxPublished(txResult.outboxId);
        } catch (err) {
          log.error(
            { err, orderId: txResult.orderId },
            'enqueue failed; outbox event remains pending'
          );
        }
      });
      checkoutDuration.labels({ phase: 'enqueue' }).observe((Date.now() - enqueueStart) / 1000);

      rootSpan.setAttribute('checkout.outcome', 'accepted');
      checkoutStarted.inc();
      log.info({ orderId: txResult.orderId, queue: CHECKOUT_QUEUE }, 'checkout accepted');
      return { kind: 'accepted', orderId: txResult.orderId, status: 'pending', replay: false };
    }
  );
}

function replayResult(existing: IdempotencyRow): CheckoutResult {
  const body = existing.response_body as { orderId?: string; code?: string; sku?: string; message?: string };
  if (existing.response_code === 202 && body.orderId) {
    return { kind: 'accepted', orderId: body.orderId, status: 'pending', replay: true };
  }
  if (existing.response_code === 409 && body.code === 'insufficient_stock') {
    return {
      kind: 'rejected',
      code: 'insufficient_stock',
      sku: body.sku ?? '',
      httpStatus: 409,
    };
  }
  if (existing.response_code === 409 && body.code === 'unknown_sku') {
    return { kind: 'rejected', code: 'unknown_sku', sku: body.sku ?? '', httpStatus: 409 };
  }
  // fallback — não deveria acontecer com nossos status_code conhecidos
  return { kind: 'in_progress', httpStatus: 409 };
}

// Helper para sinalizar conclusão fora da transação (worker -> idempotency complete já feito no service)
export async function _completeIdempotencyExternal(params: {
  key: string;
  orderId: string;
  responseBody: unknown;
  responseCode: number;
}): Promise<void> {
  await completeIdempotency(params);
}
