import { startTracing, stopTracing } from '../observability/tracing.js';

startTracing();

import { Worker, type Job } from 'bullmq';
import { CHECKOUT_QUEUE, checkoutDlq, refreshDlqGauge } from '../infra/queue.js';
import { createBullConnection } from '../infra/redis.js';
import { closeDb } from '../infra/db.js';
import { logger } from '../observability/logger.js';
import {
  checkoutCompleted,
  checkoutDuration,
  queueRetries,
  queueJobsFailed,
} from '../observability/metrics.js';
import { invoiceOrder } from '../services/fake-erp.js';
import { markOrderConfirmed, markOrderFailed } from '../repositories/orders.js';

interface CheckoutJobData {
  orderId: string;
  items: Array<{ sku: string; quantity: number }>;
  correlationId: string;
}

const worker = new Worker<CheckoutJobData>(
  CHECKOUT_QUEUE,
  async (job: Job<CheckoutJobData>) => {
    const start = Date.now();
    const log = logger.child({
      correlationId: job.data.correlationId,
      orderId: job.data.orderId,
      jobId: job.id,
      attempt: job.attemptsMade + 1,
    });
    log.info('processing checkout job');

    if (job.attemptsMade > 0) {
      queueRetries.labels({ queue: CHECKOUT_QUEUE }).inc();
    }

    const erpStart = Date.now();
    const { erpInvoiceId } = await invoiceOrder({
      orderId: job.data.orderId,
      items: job.data.items,
    });
    checkoutDuration.labels({ phase: 'erp_call' }).observe((Date.now() - erpStart) / 1000);

    await markOrderConfirmed(job.data.orderId, erpInvoiceId);
    checkoutCompleted.labels({ outcome: 'confirmed' }).inc();
    checkoutDuration.labels({ phase: 'worker' }).observe((Date.now() - start) / 1000);

    log.info({ erpInvoiceId }, 'order confirmed');
    return { erpInvoiceId };
  },
  { connection: createBullConnection(), concurrency: 5 }
);

worker.on('ready', () => logger.info({ queue: CHECKOUT_QUEUE }, 'worker ready'));
worker.on('error', (err) => logger.error({ err }, 'worker error'));

// Quando esgota as tentativas, marca o pedido como failed e envia para DLQ.
worker.on('failed', async (job, err) => {
  if (!job) return;
  const maxAttempts = job.opts.attempts ?? 1;
  const isFinal = job.attemptsMade >= maxAttempts;
  queueJobsFailed
    .labels({ queue: CHECKOUT_QUEUE, reason: isFinal ? 'exhausted' : 'attempt' })
    .inc();
  if (!isFinal) {
    logger.warn(
      { jobId: job.id, attempt: job.attemptsMade, max: maxAttempts, err: err.message },
      'job attempt failed; will retry'
    );
    return;
  }
  try {
    await markOrderFailed(job.data.orderId, err.message);
    checkoutCompleted.labels({ outcome: 'failed' }).inc();
    await checkoutDlq.add('dead', {
      original: job.data,
      failedReason: err.message,
      attempts: job.attemptsMade,
      timestamp: new Date().toISOString(),
    });
    await refreshDlqGauge();
    logger.error(
      { jobId: job.id, orderId: job.data.orderId, attempts: job.attemptsMade },
      'job exhausted retries, order marked failed and moved to DLQ'
    );
  } catch (innerErr) {
    logger.fatal({ err: innerErr, jobId: job.id }, 'failed to finalize failed job');
  }
});

const shutdown = async (signal: string) => {
  logger.info({ signal }, 'worker shutting down');
  try {
    await worker.close();
    await closeDb();
    await stopTracing();
    process.exit(0);
  } catch (err) {
    logger.error({ err }, 'worker shutdown failed');
    process.exit(1);
  }
};

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
