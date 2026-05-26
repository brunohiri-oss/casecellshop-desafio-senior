import { Queue, QueueEvents } from 'bullmq';
import { createBullConnection } from './redis.js';
import { env } from '../config/env.js';
import { logger } from '../observability/logger.js';
import { dlqSize, queueJobsFailed } from '../observability/metrics.js';

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

const checkoutEvents = new QueueEvents(CHECKOUT_QUEUE, {
  connection: createBullConnection(),
});

checkoutEvents.on('failed', async ({ jobId, failedReason }) => {
  logger.warn({ jobId, failedReason }, 'checkout job failed');
  queueJobsFailed.labels({ queue: CHECKOUT_QUEUE, reason: 'job_failed' }).inc();

  const job = await checkoutQueue.getJob(jobId);
  if (job && job.attemptsMade >= (job.opts.attempts ?? 1)) {
    await checkoutDlq.add('dead', {
      original: job.data,
      failedReason,
      attempts: job.attemptsMade,
      timestamp: new Date().toISOString(),
    });
    logger.error({ jobId, attempts: job.attemptsMade }, 'job moved to DLQ');
  }
});

checkoutEvents.on('completed', ({ jobId }) => {
  logger.debug({ jobId }, 'checkout job completed');
});

export async function refreshDlqGauge(): Promise<void> {
  const size = await checkoutDlq.count();
  dlqSize.labels({ queue: CHECKOUT_QUEUE }).set(size);
}

export async function closeQueues(): Promise<void> {
  await checkoutEvents.close();
  await checkoutQueue.close();
  await checkoutDlq.close();
}
