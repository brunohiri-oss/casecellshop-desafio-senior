import type { FastifyPluginAsync } from 'fastify';
import { registry } from '../observability/metrics.js';
import { refreshQueueGauges } from '../infra/queue.js';

const metricsRoutes: FastifyPluginAsync = async (app) => {
  app.get('/metrics', async (_req, reply) => {
    // Atualiza os gauges de fila/DLQ antes do scrape para refletir o estado atual.
    await refreshQueueGauges().catch(() => undefined);
    reply.header('Content-Type', registry.contentType);
    return reply.send(await registry.metrics());
  });
};

export default metricsRoutes;
