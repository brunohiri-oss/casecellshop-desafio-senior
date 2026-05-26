import { env } from '../config/env.js';
import { erpRequestDuration, erpErrors } from '../observability/metrics.js';
import { logger } from '../observability/logger.js';

interface InvoicePayload {
  orderId: string;
  items: Array<{ sku: string; quantity: number }>;
}

interface InvoiceResult {
  erpInvoiceId: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

/**
 * Simula a chamada síncrona ao ERP para faturamento.
 *
 * Características da simulação (controladas por env):
 * - Latência variável (ERP_LATENCY_MS_MIN..MAX) — espelha o "ERP demora pra faturar".
 * - Falha aleatória (ERP_FAILURE_RATE) — espelha indisponibilidade transiente.
 * - Idempotente: usa orderId como external_reference. Em ERP real, retornaria a
 *   mesma fatura se chamado de novo com o mesmo orderId.
 *
 * Lança erro classificado para que o worker decida retry vs DLQ.
 */
export async function invoiceOrder(payload: InvoicePayload): Promise<InvoiceResult> {
  const start = Date.now();
  const latency = randomInt(env.ERP_LATENCY_MS_MIN, env.ERP_LATENCY_MS_MAX);
  await sleep(latency);

  const shouldFail = Math.random() < env.ERP_FAILURE_RATE;
  const durationSeconds = (Date.now() - start) / 1000;

  if (shouldFail) {
    erpRequestDuration
      .labels({ endpoint: 'invoice', status: '5xx' })
      .observe(durationSeconds);
    erpErrors.labels({ endpoint: 'invoice', code: 'transient' }).inc();
    logger.warn({ orderId: payload.orderId, latency }, 'erp invoice failed (simulated)');
    const err = new Error('ERP_TRANSIENT_ERROR');
    (err as Error & { retryable: boolean }).retryable = true;
    throw err;
  }

  erpRequestDuration.labels({ endpoint: 'invoice', status: '200' }).observe(durationSeconds);
  const erpInvoiceId = `inv_${payload.orderId.slice(0, 8)}_${Date.now()}`;
  return { erpInvoiceId };
}
