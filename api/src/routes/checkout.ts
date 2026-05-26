import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { processCheckout } from '../services/checkout.js';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const checkoutBodySchema = z.object({
  items: z
    .array(
      z.object({
        sku: z.string().min(1),
        quantity: z.number().int().positive(),
      })
    )
    .min(1),
});

const checkoutRoutes: FastifyPluginAsync = async (app) => {
  app.post('/checkout', async (req, reply) => {
    const idempotencyKey = req.headers['idempotency-key'];
    if (typeof idempotencyKey !== 'string' || !UUID_REGEX.test(idempotencyKey)) {
      return reply.status(400).send({
        code: 'invalid_idempotency_key',
        message: 'Idempotency-Key header is required and must be a UUID',
      });
    }

    const parsed = checkoutBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({
        code: 'invalid_payload',
        message: 'request body validation failed',
        details: parsed.error.flatten(),
      });
    }

    const result = await processCheckout({
      idempotencyKey,
      items: parsed.data.items,
      correlationId: req.correlationId,
    });

    switch (result.kind) {
      case 'accepted':
        if (result.replay) reply.header('X-Idempotent-Replay', 'true');
        return reply
          .status(202)
          .send({ orderId: result.orderId, status: result.status });
      case 'rejected':
        return reply.status(result.httpStatus).send({
          code: result.code,
          message: `cannot fulfill sku ${result.sku}`,
          sku: result.sku,
        });
      case 'in_progress':
        return reply.status(result.httpStatus).send({
          code: 'request_in_progress',
          message: 'another request with the same Idempotency-Key is still being processed',
        });
      case 'hash_mismatch':
        return reply.status(result.httpStatus).send({
          code: 'idempotency_key_reused_with_different_payload',
          message: 'Idempotency-Key already used with a different request body',
        });
    }
  });
};

export default checkoutRoutes;
