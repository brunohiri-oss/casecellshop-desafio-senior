import type { FastifyPluginAsync } from 'fastify';
import { registry } from '../observability/metrics.js';

const metricsRoutes: FastifyPluginAsync = async (app) => {
  app.get('/metrics', async (_req, reply) => {
    reply.header('Content-Type', registry.contentType);
    return reply.send(await registry.metrics());
  });
};

export default metricsRoutes;
