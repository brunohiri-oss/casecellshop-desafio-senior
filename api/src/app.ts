import Fastify, { type FastifyInstance, type FastifyBaseLogger } from 'fastify';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { logger } from './observability/logger.js';
import { httpRequestDuration } from './observability/metrics.js';
import correlationPlugin from './observability/correlation.js';
import healthRoutes from './routes/health.js';
import metricsRoutes from './routes/metrics.js';
import productsRoutes from './routes/products.js';
import checkoutRoutes from './routes/checkout.js';
import ordersRoutes from './routes/orders.js';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    loggerInstance: logger as unknown as FastifyBaseLogger,
    disableRequestLogging: false,
    requestIdHeader: 'x-request-id',
    ajv: { customOptions: { removeAdditional: 'all', useDefaults: true } },
  });

  // Correlation ID precisa rodar antes do logger pegar o request
  await app.register(correlationPlugin);

  // Métrica de duração por request
  app.addHook('onResponse', async (req, reply) => {
    const route = req.routeOptions?.url ?? req.url ?? 'unknown';
    httpRequestDuration
      .labels({
        method: req.method,
        route,
        status_code: String(reply.statusCode),
      })
      .observe(reply.elapsedTime / 1000);
  });

  // Tratamento de erros padronizado
  app.setErrorHandler((err, req, reply) => {
    req.log.error({ err }, 'request error');
    const fastifyErr = err as { statusCode?: number; code?: string; message?: string };
    const status = fastifyErr.statusCode ?? 500;
    return reply.status(status).send({
      code: fastifyErr.code ?? 'internal_error',
      message: status >= 500 ? 'internal server error' : (fastifyErr.message ?? 'error'),
    });
  });

  // OpenAPI / Swagger UI
  await app.register(swagger, {
    openapi: {
      info: {
        title: 'CaseCellShop API',
        description: 'Desafio técnico Senior Backend — cache, idempotência, async checkout.',
        version: '0.1.0',
      },
      servers: [{ url: 'http://localhost:3000' }],
    },
  });
  await app.register(swaggerUi, { routePrefix: '/docs' });

  await app.register(healthRoutes);
  await app.register(metricsRoutes);
  await app.register(productsRoutes);
  await app.register(checkoutRoutes);
  await app.register(ordersRoutes);

  return app;
}
