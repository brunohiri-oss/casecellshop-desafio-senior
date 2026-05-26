import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { pool, closeDb } from '../src/infra/db.js';
import { redis, closeRedis } from '../src/infra/redis.js';
import { checkoutQueue, checkoutDlq, closeQueues } from '../src/infra/queue.js';

export async function truncateAll(): Promise<void> {
  await pool.query(`
    TRUNCATE TABLE orders, idempotency_keys, outbox_events RESTART IDENTITY;
    DELETE FROM products;
  `);
}

export async function seedProduct(params: {
  sku: string;
  name?: string;
  priceCents?: number;
  stock: number;
}): Promise<void> {
  await pool.query(
    `INSERT INTO products (sku, name, price_cents, stock)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (sku) DO UPDATE SET stock = EXCLUDED.stock, price_cents = EXCLUDED.price_cents`,
    [params.sku, params.name ?? params.sku, params.priceCents ?? 1000, params.stock]
  );
}

export async function flushAppCache(): Promise<void> {
  // Apaga chaves de cache: e locks usados pelos testes.
  const keys = await redis.keys('products:list:*');
  const lockKeys = await redis.keys('lock:*');
  const all = [...keys, ...lockKeys];
  if (all.length > 0) await redis.del(...all);
}

export async function purgeQueues(): Promise<void> {
  await checkoutQueue.obliterate({ force: true });
  await checkoutDlq.obliterate({ force: true });
}

export async function fullReset(): Promise<void> {
  await Promise.all([truncateAll(), flushAppCache(), purgeQueues()]);
}

export async function newApp(): Promise<FastifyInstance> {
  return buildApp();
}

export async function closeAll(): Promise<void> {
  await closeQueues().catch(() => undefined);
  await closeDb().catch(() => undefined);
  await closeRedis().catch(() => undefined);
}

export async function getProductStock(sku: string): Promise<number | null> {
  const res = await pool.query<{ stock: number }>('SELECT stock FROM products WHERE sku=$1', [sku]);
  return res.rows[0]?.stock ?? null;
}

export async function countOrdersForSku(sku: string): Promise<number> {
  const res = await pool.query<{ c: string }>(
    `SELECT COUNT(*)::text AS c FROM orders WHERE items::text LIKE '%' || $1 || '%'`,
    [sku]
  );
  return parseInt(res.rows[0]!.c, 10);
}
