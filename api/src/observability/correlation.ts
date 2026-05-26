import { randomUUID } from 'node:crypto';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';

declare module 'fastify' {
  interface FastifyRequest {
    correlationId: string;
  }
}

const correlationIdPlugin: FastifyPluginAsync = async (app) => {
  app.addHook('onRequest', async (req: FastifyRequest, reply) => {
    const incoming = req.headers['x-correlation-id'];
    const id = typeof incoming === 'string' && incoming.length > 0 ? incoming : randomUUID();
    req.correlationId = id;
    reply.header('x-correlation-id', id);
    req.log = req.log.child({ correlationId: id });
  });
};

export default fp(correlationIdPlugin, { name: 'correlation-id' });
