import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  closeAll,
  countOrdersForSku,
  fullReset,
  getProductStock,
  newApp,
  seedProduct,
} from './helpers.js';

describe('Anti-overselling (concurrency)', () => {
  beforeEach(async () => {
    await fullReset();
  });

  afterAll(async () => {
    await closeAll();
  });

  it('apenas 1 de 50 requests concorrentes ganha o último item', async () => {
    const sku = 'TEST-LAST-1';
    await seedProduct({ sku, stock: 1 });

    const app = await newApp();
    try {
      const responses = await Promise.all(
        Array.from({ length: 50 }, () =>
          app.inject({
            method: 'POST',
            url: '/checkout',
            headers: { 'idempotency-key': randomUUID(), 'content-type': 'application/json' },
            payload: { items: [{ sku, quantity: 1 }] },
          })
        )
      );

      const accepted = responses.filter((r) => r.statusCode === 202);
      const conflicts = responses.filter((r) => r.statusCode === 409);
      const other = responses.filter((r) => r.statusCode !== 202 && r.statusCode !== 409);

      expect(accepted).toHaveLength(1);
      expect(conflicts).toHaveLength(49);
      expect(other).toHaveLength(0);

      // Banco é a fonte da verdade
      expect(await getProductStock(sku)).toBe(0);
      expect(await countOrdersForSku(sku)).toBe(1);
    } finally {
      await app.close();
    }
  });

  it('multi-item: rollback restaura decrementos parciais se um SKU falhar', async () => {
    const okSku = 'TEST-OK';
    const failSku = 'TEST-FAIL';
    await seedProduct({ sku: okSku, stock: 10 });
    await seedProduct({ sku: failSku, stock: 0 });

    const app = await newApp();
    try {
      const r = await app.inject({
        method: 'POST',
        url: '/checkout',
        headers: { 'idempotency-key': randomUUID(), 'content-type': 'application/json' },
        payload: { items: [{ sku: okSku, quantity: 1 }, { sku: failSku, quantity: 1 }] },
      });
      expect(r.statusCode).toBe(409);
      // OK SKU não foi decrementado porque a tx aborta antes do commit
      expect(await getProductStock(okSku)).toBe(10);
      expect(await getProductStock(failSku)).toBe(0);
      expect(await countOrdersForSku(okSku)).toBe(0);
    } finally {
      await app.close();
    }
  });
});
