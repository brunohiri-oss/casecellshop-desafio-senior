import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { closeAll, fullReset, newApp, seedProduct } from './helpers.js';
import { checkoutQueue } from '../src/infra/queue.js';

describe('Smoke — endpoints respondem com schemas esperados', () => {
  beforeEach(async () => {
    await fullReset();
  });

  afterAll(async () => {
    await closeAll();
  });

  it('GET /health → 200 com checks de db e redis', async () => {
    const app = await newApp();
    try {
      const r = await app.inject({ method: 'GET', url: '/health' });
      expect(r.statusCode).toBe(200);
      const body = r.json();
      expect(body.status).toBe('ok');
      expect(body.checks.db).toBe(true);
      expect(body.checks.redis).toBe(true);
    } finally {
      await app.close();
    }
  });

  it('GET /metrics → 200 com formato Prometheus + metricas customizadas', async () => {
    const app = await newApp();
    try {
      const r = await app.inject({ method: 'GET', url: '/metrics' });
      expect(r.statusCode).toBe(200);
      expect(r.headers['content-type']).toMatch(/^text\/plain/);
      expect(r.body).toMatch(/cache_hits_total/);
      expect(r.body).toMatch(/checkout_started_total/);
      expect(r.body).toMatch(/dlq_size/);
    } finally {
      await app.close();
    }
  });

  it('GET /products vazio retorna array vazio (não 500)', async () => {
    const app = await newApp();
    try {
      const r = await app.inject({ method: 'GET', url: '/products' });
      expect(r.statusCode).toBe(200);
      expect(r.json()).toEqual([]);
    } finally {
      await app.close();
    }
  });

  it('POST /checkout enfileira job na fila checkout (jobId = orderId)', async () => {
    await seedProduct({ sku: 'SMOKE-1', stock: 3 });
    const app = await newApp();
    try {
      const r = await app.inject({
        method: 'POST',
        url: '/checkout',
        headers: { 'idempotency-key': randomUUID(), 'content-type': 'application/json' },
        payload: { items: [{ sku: 'SMOKE-1', quantity: 1 }] },
      });
      expect(r.statusCode).toBe(202);
      const { orderId } = r.json();
      const job = await checkoutQueue.getJob(orderId);
      expect(job).not.toBeNull();
      expect(job?.data.orderId).toBe(orderId);
      // _otel carrier só é populado quando OTel está ligado; nos testes está off.
      expect(job?.data).toHaveProperty('_otel');
    } finally {
      await app.close();
    }
  });

  it('GET /orders/:id/status retorna 404 para id desconhecido', async () => {
    const app = await newApp();
    try {
      const r = await app.inject({
        method: 'GET',
        url: `/orders/${randomUUID()}/status`,
      });
      expect(r.statusCode).toBe(404);
      expect(r.json().code).toBe('order_not_found');
    } finally {
      await app.close();
    }
  });

  it('GET /orders/:id/status com id inválido retorna 400', async () => {
    const app = await newApp();
    try {
      const r = await app.inject({
        method: 'GET',
        url: `/orders/not-a-uuid/status`,
      });
      expect(r.statusCode).toBe(400);
      expect(r.json().code).toBe('invalid_order_id');
    } finally {
      await app.close();
    }
  });

  it('GET /admin/dlq retorna size + items', async () => {
    const app = await newApp();
    try {
      const r = await app.inject({ method: 'GET', url: '/admin/dlq' });
      expect(r.statusCode).toBe(200);
      const body = r.json();
      expect(body.queue).toBe('checkout-dlq');
      expect(body.size).toBe(0);
      expect(Array.isArray(body.items)).toBe(true);
    } finally {
      await app.close();
    }
  });
});
