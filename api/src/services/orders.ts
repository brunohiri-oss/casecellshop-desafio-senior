import { getOrderById } from '../repositories/orders.js';

export interface OrderStatusResponse {
  orderId: string;
  status: 'pending' | 'confirmed' | 'failed';
  erpInvoiceId: string | null;
  failedReason: string | null;
}

export async function getOrderStatus(orderId: string): Promise<OrderStatusResponse | null> {
  const order = await getOrderById(orderId);
  if (!order) return null;
  return {
    orderId: order.id,
    status: order.status,
    erpInvoiceId: order.erp_invoice_id,
    failedReason: order.failed_reason,
  };
}
