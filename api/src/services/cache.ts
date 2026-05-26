import { randomUUID } from 'node:crypto';
import { redis } from '../infra/redis.js';
import { cacheHits, cacheMisses, cacheLockWait, cacheValueAge } from '../observability/metrics.js';
import { logger } from '../observability/logger.js';

interface CacheEnvelope<T> {
  v: T;
  ts: number; // epoch ms when stored
}

export type CacheStatus = 'hit' | 'miss' | 'stale' | 'computed';

export interface CacheResult<T> {
  value: T;
  status: CacheStatus;
}

interface SingleFlightOptions<T> {
  key: string;
  keyPrefix: string;
  ttlSeconds: number;
  lockTtlSeconds: number;
  loader: () => Promise<T>;
  maxWaitMs?: number;
}

function jitter(base: number, ratio = 0.1): number {
  return base + Math.floor((Math.random() - 0.5) * 2 * ratio * base);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function tryGet<T>(key: string, keyPrefix: string): Promise<CacheEnvelope<T> | null> {
  const raw = await redis.get(key);
  if (!raw) return null;
  try {
    const env = JSON.parse(raw) as CacheEnvelope<T>;
    cacheValueAge.labels({ key_prefix: keyPrefix }).observe((Date.now() - env.ts) / 1000);
    return env;
  } catch (err) {
    logger.warn({ err, key }, 'cache value corrupted, treating as miss');
    return null;
  }
}

async function storeValue<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
  const envelope: CacheEnvelope<T> = { v: value, ts: Date.now() };
  await redis.set(key, JSON.stringify(envelope), 'EX', jitter(ttlSeconds));
}

/**
 * Cache-aside com prevenção de stampede via single-flight lock.
 * - Primeira request com miss adquire um lock no Redis (SET NX EX).
 * - Requests concorrentes esperam (com backoff) e tentam ler o cache de novo.
 * - Se o lock holder falhar, o lock expira e outra request assume.
 * - TTL com jitter de ±10% espalha expirações no tempo.
 */
export async function getWithSingleFlight<T>(opts: SingleFlightOptions<T>): Promise<CacheResult<T>> {
  const { key, keyPrefix, ttlSeconds, lockTtlSeconds, loader, maxWaitMs = 2000 } = opts;

  const initial = await tryGet<T>(key, keyPrefix);
  if (initial) {
    cacheHits.labels({ key_prefix: keyPrefix }).inc();
    return { value: initial.v, status: 'hit' };
  }
  cacheMisses.labels({ key_prefix: keyPrefix }).inc();

  const lockKey = `lock:${key}`;
  const lockToken = randomUUID();
  const acquired = await redis.set(lockKey, lockToken, 'EX', lockTtlSeconds, 'NX');

  if (acquired === 'OK') {
    try {
      const value = await loader();
      await storeValue(key, value, ttlSeconds);
      return { value, status: 'computed' };
    } finally {
      // Lua script: só libera o lock se o token for nosso (evita liberar lock alheio
      // se nossa operação demorou e o lock expirou).
      const releaseScript = `
        if redis.call("get", KEYS[1]) == ARGV[1] then
          return redis.call("del", KEYS[1])
        else
          return 0
        end`;
      await redis.eval(releaseScript, 1, lockKey, lockToken).catch((err) => {
        logger.warn({ err, lockKey }, 'lock release failed (likely expired)');
      });
    }
  }

  // Lock detido por outra request — aguardar
  const waitStart = Date.now();
  const backoffBase = 50;
  let attempt = 0;
  while (Date.now() - waitStart < maxWaitMs) {
    await sleep(backoffBase + Math.random() * backoffBase * attempt);
    const cached = await tryGet<T>(key, keyPrefix);
    if (cached) {
      cacheLockWait.labels({ key_prefix: keyPrefix }).observe((Date.now() - waitStart) / 1000);
      return { value: cached.v, status: 'hit' };
    }
    attempt++;
  }

  // Esgotamos o tempo de espera — modo degradado: rodar o loader nós mesmos.
  cacheLockWait.labels({ key_prefix: keyPrefix }).observe((Date.now() - waitStart) / 1000);
  logger.warn({ key }, 'single-flight wait timed out, falling through to loader');
  const value = await loader();
  return { value, status: 'computed' };
}

/** Invalidação ativa (ex.: chamada por sync do ERP quando preço/estoque muda). */
export async function invalidate(key: string): Promise<void> {
  await redis.del(key);
}
