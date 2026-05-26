import { Queue } from 'bullmq';
import { createBullConnection } from './redis.js';
import { env } from '../config/env.js';
import { dlqSize, queueJobsWaiting, queueJobsActive } from '../observability/metrics.js';

export const CHECKOUT_QUEUE = 'checkout';
export const CHECKOUT_DLQ = 'checkout-dlq';

export const checkoutQueue = new Queue(CHECKOUT_QUEUE, {
  connection: createBullConnection(),
  defaultJobOptions: {
    attempts: env.CHECKOUT_QUEUE_MAX_ATTEMPTS,
    backoff: {
      type: 'exponential',
      delay: 1000,
    },
    removeOnComplete: { age: 3600, count: 1000 },
    removeOnFail: false,
  },
});

export const checkoutDlq = new Queue(CHECKOUT_DLQ, {
  connection: createBullConnection(),
  defaultJobOptions: {
    removeOnComplete: false,
    removeOnFail: false,
  },
});

/** Atualiza os gauges da fila — chamado sob demanda (ex.: /metrics scrape). */
export async function refreshQueueGauges(): Promise<void> {
  const [waiting, active, dlq] = await Promise.all([
    checkoutQueue.getWaitingCount(),
    checkoutQueue.getActiveCount(),
    checkoutDlq.count(),
  ]);
  queueJobsWaiting.labels({ queue: CHECKOUT_QUEUE }).set(waiting);
  queueJobsActive.labels({ queue: CHECKOUT_QUEUE }).set(active);
  dlqSize.labels({ queue: CHECKOUT_QUEUE }).set(dlq);
}

export async function refreshDlqGauge(): Promise<void> {
  const size = await checkoutDlq.count();
  dlqSize.labels({ queue: CHECKOUT_QUEUE }).set(size);
}

export async function closeQueues(): Promise<void> {
  await checkoutQueue.close();
  await checkoutDlq.close();
}
