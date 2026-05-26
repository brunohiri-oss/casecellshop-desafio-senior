import type { FastifyPluginAsync } from 'fastify';
import { getProductsCatalog } from '../services/products.js';

const productsRoutes: FastifyPluginAsync = async (app) => {
  app.get('/products', {
    schema: {
      response: {
        200: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              sku: { type: 'string' },
              name: { type: 'string' },
              price: { type: 'number' },
              available: { type: 'integer' },
            },
            required: ['sku', 'name', 'price', 'available'],
          },
        },
      },
    },
  }, async (req, reply) => {
    const result = await getProductsCatalog();
    const headerStatus = result.cacheStatus === 'hit' ? 'HIT' : 'MISS';
    reply.header('X-Cache', headerStatus);
    req.log.info({ cacheStatus: result.cacheStatus, count: result.products.length }, 'products served');
    return reply.send(result.products);
  });
};

export default productsRoutes;
