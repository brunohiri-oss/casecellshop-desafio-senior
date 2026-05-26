import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeAll, fullReset, newApp, seedProduct } from './helpers.js';
import { getWithSingleFlight } from '../src/services/cache.js';
import { redis } from '../src/infra/redis.js';

// closeAll só pode ser chamado uma vez no arquivo (fecha conexões globais).
afterAll(async () => {
  await closeAll();
});

describe('Cache — HIT/MISS via /products', () => {
  beforeEach(async () => {
    await fullReset();
  });

  it('primeira chamada MISS, segunda HIT, expira após TTL', async () => {
    await seedProduct({ sku: 'CACHE-1', stock: 5 });

    const app = await newApp();
    try {
      const r1 = await app.inject({ method: 'GET', url: '/products' });
      expect(r1.statusCode).toBe(200);
      expect(r1.headers['x-cache']).toBe('MISS');

      const r2 = await app.inject({ method: 'GET', url: '/products' });
      expect(r2.statusCode).toBe(200);
      expect(r2.headers['x-cache']).toBe('HIT');

      // TTL configurado para 2s no setup.ts; mais jitter de -10% => ~1.8s mínimo.
      // Esperamos 2.5s para garantir expiração e nova MISS.
      await new Promise((resolve) => setTimeout(resolve, 2500));
      const r3 = await app.inject({ method: 'GET', url: '/products' });
      expect(r3.headers['x-cache']).toBe('MISS');
    } finally {
      await app.close();
    }
  });
});

describe('Cache — single-flight (anti-stampede) — unit', () => {
  beforeEach(async () => {
    const keys = await redis.keys('test-sf:*');
    const locks = await redis.keys('lock:test-sf:*');
    const all = [...keys, ...locks];
    if (all.length > 0) await redis.del(...all);
  });

  it('20 requests concorrentes num miss disparam o loader 1× só', async () => {
    const key = 'test-sf:hot';
    const loader = vi.fn(async () => {
      // Simula uma carga lenta: durante essa janela todas as concorrentes deveriam
      // esperar no lock e ler do cache em vez de chamar o loader.
      await new Promise((resolve) => setTimeout(resolve, 200));
      return { value: 42, ts: Date.now() };
    });

    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        getWithSingleFlight({
          key,
          keyPrefix: 'test-sf',
          ttlSeconds: 30,
          lockTtlSeconds: 5,
          loader,
        })
      )
    );

    expect(results).toHaveLength(20);
    expect(results.every((r) => r.value.value === 42)).toBe(true);

    // A invariante do single-flight: loader é chamado UMA vez.
    expect(loader).toHaveBeenCalledTimes(1);

    // Pelo menos 1 status "computed" (quem ganhou o lock) e o resto "hit" pós-espera.
    const computed = results.filter((r) => r.status === 'computed').length;
    const hits = results.filter((r) => r.status === 'hit').length;
    expect(computed).toBe(1);
    expect(hits).toBe(19);
  });
});
