import type { FastifyPluginAsync } from 'fastify';
import { getOrderStatus } from '../services/orders.js';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ordersRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Params: { orderId: string } }>('/orders/:orderId/status', async (req, reply) => {
    const { orderId } = req.params;
    if (!UUID_REGEX.test(orderId)) {
      return reply.status(400).send({
        code: 'invalid_order_id',
        message: 'orderId must be a UUID',
      });
    }
    const status = await getOrderStatus(orderId);
    if (!status) {
      return reply.status(404).send({
        code: 'order_not_found',
        message: 'no order with that id',
      });
    }
    req.log.info({ orderId, status: status.status }, 'order status served');
    return reply.send(status);
  });
};

export default ordersRoutes;
