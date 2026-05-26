import type { PoolClient } from 'pg';
import { pool } from '../infra/db.js';
import type { CheckoutItem } from './stock.js';

export type OrderStatus = 'pending' | 'confirmed' | 'failed';

export interface OrderRow {
  id: string;
  items: CheckoutItem[];
  status: OrderStatus;
  idempotency_key: string;
  erp_invoice_id: string | null;
  failed_reason: string | null;
  created_at: Date;
  updated_at: Date;
}

export async function insertOrderTx(
  client: PoolClient,
  params: { id: string; items: CheckoutItem[]; idempotencyKey: string }
): Promise<void> {
  await client.query(
    `INSERT INTO orders (id, items, status, idempotency_key)
     VALUES ($1, $2::jsonb, 'pending', $3)`,
    [params.id, JSON.stringify(params.items), params.idempotencyKey]
  );
}

export async function getOrderById(id: string): Promise<OrderRow | null> {
  const res = await pool.query<OrderRow>(
    `SELECT id, items, status, idempotency_key, erp_invoice_id, failed_reason, created_at, updated_at
     FROM orders WHERE id = $1`,
    [id]
  );
  return res.rows[0] ?? null;
}

export async function markOrderConfirmed(id: string, erpInvoiceId: string): Promise<void> {
  await pool.query(
    `UPDATE orders SET status = 'confirmed', erp_invoice_id = $1, updated_at = now()
     WHERE id = $2 AND status = 'pending'`,
    [erpInvoiceId, id]
  );
}

export async function markOrderFailed(id: string, reason: string): Promise<void> {
  await pool.query(
    `UPDATE orders SET status = 'failed', failed_reason = $1, updated_at = now()
     WHERE id = $2 AND status = 'pending'`,
    [reason, id]
  );
}
