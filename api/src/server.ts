import { startTracing, stopTracing } from './observability/tracing.js';

startTracing(); // antes de qualquer import que dependa de auto-instrumentação

import { buildApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './observability/logger.js';
import { closeDb } from './infra/db.js';
import { closeRedis } from './infra/redis.js';

async function main() {
  const app = await buildApp();
  await app.listen({ port: env.PORT, host: '0.0.0.0' });
  logger.info({ port: env.PORT }, 'api listening');

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'shutting down');
    try {
      await app.close();
      await closeDb();
      await closeRedis();
      await stopTracing();
      process.exit(0);
    } catch (err) {
      logger.error({ err }, 'shutdown failed');
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  logger.fatal({ err }, 'failed to start');
  process.exit(1);
});
