import type { FastifyPluginAsync } from 'fastify';
import { checkoutDlq, refreshQueueGauges } from '../infra/queue.js';

/**
 * Endpoints administrativos. Em produção, exigem autenticação dedicada
 * (apiKey/JWT com escopo admin). Aqui ficam abertos para fins do desafio —
 * documentado no README como simplificação.
 */
const adminRoutes: FastifyPluginAsync = async (app) => {
  // Inspeção da DLQ — primeira chamada do runbook quando dlq_size > 0.
  app.get<{ Querystring: { limit?: string } }>(
    '/admin/dlq',
    async (req, reply) => {
      const limit = Math.min(Math.max(parseInt(req.query.limit ?? '20', 10) || 20, 1), 100);
      const [count, jobs] = await Promise.all([
        checkoutDlq.count(),
        checkoutDlq.getJobs(['waiting', 'completed', 'failed'], 0, limit - 1, true),
      ]);
      return reply.send({
        queue: 'checkout-dlq',
        size: count,
        items: jobs.map((j) => ({
          id: j.id,
          timestamp: j.timestamp,
          data: j.data,
          attemptsMade: j.attemptsMade,
        })),
      });
    }
  );

  // Refresh manual dos gauges (útil para troubleshoot, mas a rota /metrics já faz isso).
  app.post('/admin/queue/gauges/refresh', async (_req, reply) => {
    await refreshQueueGauges();
    return reply.status(204).send();
  });
};

export default adminRoutes;
