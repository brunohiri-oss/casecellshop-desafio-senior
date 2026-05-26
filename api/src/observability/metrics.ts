import { Registry, collectDefaultMetrics, Counter, Gauge, Histogram } from 'prom-client';

export const registry = new Registry();
collectDefaultMetrics({ register: registry });

// ---------- HTTP ----------
export const httpRequestDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [registry],
});

// ---------- Cache ----------
export const cacheHits = new Counter({
  name: 'cache_hits_total',
  help: 'Cache hits',
  labelNames: ['key_prefix'],
  registers: [registry],
});

export const cacheMisses = new Counter({
  name: 'cache_misses_total',
  help: 'Cache misses',
  labelNames: ['key_prefix'],
  registers: [registry],
});

export const cacheLockWait = new Histogram({
  name: 'cache_lock_wait_seconds',
  help: 'Time spent waiting on cache single-flight lock',
  labelNames: ['key_prefix'],
  buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5],
  registers: [registry],
});

export const cacheValueAge = new Histogram({
  name: 'cache_value_age_seconds',
  help: 'Age of cached value when served',
  labelNames: ['key_prefix'],
  buckets: [1, 5, 10, 30, 60, 300],
  registers: [registry],
});

// ---------- Checkout ----------
export const checkoutStarted = new Counter({
  name: 'checkout_started_total',
  help: 'Checkout requests accepted (202)',
  registers: [registry],
});

export const checkoutCompleted = new Counter({
  name: 'checkout_completed_total',
  help: 'Checkout terminal outcomes',
  labelNames: ['outcome'], // confirmed | failed
  registers: [registry],
});

export const checkoutDuration = new Histogram({
  name: 'checkout_duration_seconds',
  help: 'Duration of checkout phases',
  labelNames: ['phase'], // reserve_stock | enqueue | worker | erp_call
  buckets: [0.005, 0.01, 0.05, 0.1, 0.5, 1, 2, 5, 10, 30],
  registers: [registry],
});

export const checkoutIdempotencyReplays = new Counter({
  name: 'checkout_idempotency_replays_total',
  help: 'Checkout requests served from idempotency cache',
  registers: [registry],
});

export const stockReserveConflicts = new Counter({
  name: 'stock_reserve_conflicts_total',
  help: 'Stock reservation conflicts (insufficient stock)',
  labelNames: ['sku'],
  registers: [registry],
});

// ---------- Queue ----------
export const queueJobsWaiting = new Gauge({
  name: 'queue_jobs_waiting',
  help: 'Jobs waiting in the queue',
  labelNames: ['queue'],
  registers: [registry],
});

export const queueJobsActive = new Gauge({
  name: 'queue_jobs_active',
  help: 'Jobs currently being processed',
  labelNames: ['queue'],
  registers: [registry],
});

export const queueJobsFailed = new Counter({
  name: 'queue_jobs_failed_total',
  help: 'Jobs that failed',
  labelNames: ['queue', 'reason'],
  registers: [registry],
});

export const queueRetries = new Counter({
  name: 'queue_retry_total',
  help: 'Job retries',
  labelNames: ['queue'],
  registers: [registry],
});

export const dlqSize = new Gauge({
  name: 'dlq_size',
  help: 'Dead letter queue size',
  labelNames: ['queue'],
  registers: [registry],
});

// ---------- ERP ----------
export const erpRequestDuration = new Histogram({
  name: 'erp_request_duration_seconds',
  help: 'ERP request duration',
  labelNames: ['endpoint', 'status'],
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
  registers: [registry],
});

export const erpErrors = new Counter({
  name: 'erp_errors_total',
  help: 'ERP errors',
  labelNames: ['endpoint', 'code'],
  registers: [registry],
});
