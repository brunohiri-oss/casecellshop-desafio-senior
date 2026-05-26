// Roda UMA vez no final de toda a suíte (não em cada teste).
// Restaura o estado para "como se nada tivesse rodado":
//   - DB com catálogo seedado (os 9 SKUs padrão)
//   - Tabelas transacionais limpas
//   - Cache Redis e filas BullMQ vazios
//
// Vitest invoca `teardown` do arquivo apontado em `globalSetup` em
// vitest.config.ts.

import pg from 'pg';
import { Redis } from 'ioredis';

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://cellshop:cellshop@localhost:5432/cellshop';
const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';

const CATALOG = [
  { sku: 'CAP-IP15-CLR', name: 'Capinha iPhone 15 Transparente', price_cents: 4990, stock: 120 },
  { sku: 'CAP-IP15-BLK', name: 'Capinha iPhone 15 Preta', price_cents: 5990, stock: 80 },
  { sku: 'CAP-IP15-PRO-LTH', name: 'Capinha iPhone 15 Pro Couro', price_cents: 12990, stock: 30 },
  { sku: 'CAP-GAL-S24-CLR', name: 'Capinha Galaxy S24 Transparente', price_cents: 4490, stock: 150 },
  { sku: 'CAP-GAL-S24-BLU', name: 'Capinha Galaxy S24 Azul', price_cents: 5490, stock: 60 },
  { sku: 'CAP-IP14-CLR', name: 'Capinha iPhone 14 Transparente', price_cents: 3990, stock: 200 },
  { sku: 'CAP-MOTO-G84', name: 'Capinha Moto G84', price_cents: 2990, stock: 100 },
  { sku: 'CAP-XIAOMI-R13', name: 'Capinha Redmi 13', price_cents: 2490, stock: 90 },
  { sku: 'CAP-IP15-RARE', name: 'Capinha iPhone 15 Edição Limitada', price_cents: 19990, stock: 1 },
];

export async function teardown(): Promise<void> {
  const pool = new pg.Pool({ connectionString: DATABASE_URL });
  const redis = new Redis(REDIS_URL, { maxRetriesPerRequest: null, lazyConnect: true });

  try {
    await redis.connect();

    // 1) Limpar todo estado dos testes no DB
    await pool.query(`
      TRUNCATE TABLE orders, idempotency_keys, outbox_events RESTART IDENTITY;
      DELETE FROM products;
    `);

    // 2) Restaurar catálogo seedado canônico
    for (const p of CATALOG) {
      await pool.query(
        `INSERT INTO products (sku, name, price_cents, stock) VALUES ($1, $2, $3, $4)`,
        [p.sku, p.name, p.price_cents, p.stock]
      );
    }

    // 3) Limpar cache e filas no Redis
    const cacheKeys = await redis.keys('products:list:*');
    const lockKeys = await redis.keys('lock:*');
    const testKeys = await redis.keys('test-sf:*');
    const allKeys = [...cacheKeys, ...lockKeys, ...testKeys];
    if (allKeys.length > 0) await redis.del(...allKeys);

    // 4) Limpar filas BullMQ (chaves bull:* incluem checkout e checkout-dlq)
    const bullKeys = await redis.keys('bull:*');
    if (bullKeys.length > 0) await redis.del(...bullKeys);
  } catch (err) {
    // Não estourar o processo de testes — só logar.
    // eslint-disable-next-line no-console
    console.error('[globalTeardown] cleanup failed:', err);
  } finally {
    await pool.end().catch(() => undefined);
    await redis.quit().catch(() => undefined);
  }
}
