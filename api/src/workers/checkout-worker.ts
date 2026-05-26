// Worker do checkout — stub para Fase 2.1.
// A lógica completa (chamada ao ERP simulado, retry, DLQ, atualização do pedido)
// será implementada na Fase 2.2 / 2.3.
import { startTracing, stopTracing } from '../observability/tracing.js';

startTracing();

import { Worker } from 'bullmq';
import { CHECKOUT_QUEUE } from '../infra/queue.js';
import { createBullConnection } from '../infra/redis.js';
import { logger } from '../observability/logger.js';
import { closeDb } from '../infra/db.js';

const worker = new Worker(
  CHECKOUT_QUEUE,
  async (job) => {
    logger.info({ jobId: job.id, data: job.data }, 'checkout job received (stub)');
    // implementação real virá na Fase 2.2
  },
  { connection: createBullConnection(), concurrency: 5 }
);

worker.on('ready', () => logger.info({ queue: CHECKOUT_QUEUE }, 'worker ready'));
worker.on('error', (err) => logger.error({ err }, 'worker error'));

const shutdown = async (signal: string) => {
  logger.info({ signal }, 'worker shutting down');
  await worker.close();
  await closeDb();
  await stopTracing();
  process.exit(0);
};

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
