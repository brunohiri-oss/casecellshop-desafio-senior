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

describe('Idempotência', () => {
  beforeEach(async () => {
    await fullReset();
  });

  afterAll(async () => {
    await closeAll();
  });

  it('replay com mesma key retorna mesmo orderId e NÃO decrementa estoque duas vezes', async () => {
    const sku = 'IDEM-1';
    await seedProduct({ sku, stock: 5 });

    const app = await newApp();
    try {
      const key = randomUUID();
      const headers = { 'idempotency-key': key, 'content-type': 'application/json' };
      const payload = { items: [{ sku, quantity: 2 }] };

      const r1 = await app.inject({ method: 'POST', url: '/checkout', headers, payload });
      const r2 = await app.inject({ method: 'POST', url: '/checkout', headers, payload });

      expect(r1.statusCode).toBe(202);
      expect(r2.statusCode).toBe(202);

      const b1 = r1.json();
      const b2 = r2.json();
      expect(b1.orderId).toEqual(b2.orderId);
      expect(r2.headers['x-idempotent-replay']).toBe('true');

      // Decremento aconteceu UMA vez: 5 - 2 = 3
      expect(await getProductStock(sku)).toBe(3);
      expect(await countOrdersForSku(sku)).toBe(1);
    } finally {
      await app.close();
    }
  });

  it('mesma key com payload diferente retorna 422', async () => {
    await seedProduct({ sku: 'IDEM-A', stock: 5 });
    await seedProduct({ sku: 'IDEM-B', stock: 5 });

    const app = await newApp();
    try {
      const key = randomUUID();
      const headers = { 'idempotency-key': key, 'content-type': 'application/json' };

      const r1 = await app.inject({
        method: 'POST',
        url: '/checkout',
        headers,
        payload: { items: [{ sku: 'IDEM-A', quantity: 1 }] },
      });
      expect(r1.statusCode).toBe(202);

      const r2 = await app.inject({
        method: 'POST',
        url: '/checkout',
        headers,
        payload: { items: [{ sku: 'IDEM-B', quantity: 1 }] },
      });
      expect(r2.statusCode).toBe(422);
      expect(r2.json().code).toBe('idempotency_key_reused_with_different_payload');
    } finally {
      await app.close();
    }
  });

  it('Idempotency-Key inválido (não-UUID) retorna 400', async () => {
    await seedProduct({ sku: 'IDEM-C', stock: 5 });
    const app = await newApp();
    try {
      const r = await app.inject({
        method: 'POST',
        url: '/checkout',
        headers: { 'idempotency-key': 'not-a-uuid', 'content-type': 'application/json' },
        payload: { items: [{ sku: 'IDEM-C', quantity: 1 }] },
      });
      expect(r.statusCode).toBe(400);
      expect(r.json().code).toBe('invalid_idempotency_key');
    } finally {
      await app.close();
    }
  });

  it('hash insensitive à ordem dos items (mesma intenção, ordem diferente, replay funciona)', async () => {
    await seedProduct({ sku: 'IDEM-X', stock: 5 });
    await seedProduct({ sku: 'IDEM-Y', stock: 5 });
    const app = await newApp();
    try {
      const key = randomUUID();
      const headers = { 'idempotency-key': key, 'content-type': 'application/json' };

      const r1 = await app.inject({
        method: 'POST',
        url: '/checkout',
        headers,
        payload: { items: [{ sku: 'IDEM-X', quantity: 1 }, { sku: 'IDEM-Y', quantity: 1 }] },
      });
      const r2 = await app.inject({
        method: 'POST',
        url: '/checkout',
        headers,
        payload: { items: [{ sku: 'IDEM-Y', quantity: 1 }, { sku: 'IDEM-X', quantity: 1 }] },
      });
      expect(r1.statusCode).toBe(202);
      expect(r2.statusCode).toBe(202);
      expect(r2.json().orderId).toEqual(r1.json().orderId);
    } finally {
      await app.close();
    }
  });
});
