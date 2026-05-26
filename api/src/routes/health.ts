import type { FastifyPluginAsync } from 'fastify';
import { pingDb } from '../infra/db.js';
import { pingRedis } from '../infra/redis.js';

const healthRoutes: FastifyPluginAsync = async (app) => {
  const healthSchema = {
    type: 'object',
    properties: {
      status: { type: 'string' },
      checks: {
        type: 'object',
        properties: {
          db: { type: 'boolean' },
          redis: { type: 'boolean' },
        },
      },
    },
  } as const;

  app.get('/health', {
    schema: {
      response: {
        200: healthSchema,
        503: healthSchema,
      },
    },
  }, async (_req, reply) => {
    const [db, redis] = await Promise.all([pingDb(), pingRedis()]);
    const healthy = db && redis;
    const status: 200 | 503 = healthy ? 200 : 503;
    return reply.status(status).send({
      status: healthy ? 'ok' : 'degraded',
      checks: { db, redis },
    });
  });
};

export default healthRoutes;
