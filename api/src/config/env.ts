import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  SERVICE_NAME: z.string().default('casecellshop-api'),

  REDIS_URL: z.string().url().default('redis://localhost:6379'),
  DATABASE_URL: z.string().url().default('postgres://cellshop:cellshop@localhost:5432/cellshop'),

  PRODUCTS_CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(30),
  PRODUCTS_CACHE_LOCK_TTL_SECONDS: z.coerce.number().int().positive().default(5),

  IDEMPOTENCY_TTL_HOURS: z.coerce.number().int().positive().default(24),

  ERP_FAILURE_RATE: z.coerce.number().min(0).max(1).default(0.2),
  ERP_LATENCY_MS_MIN: z.coerce.number().int().nonnegative().default(200),
  ERP_LATENCY_MS_MAX: z.coerce.number().int().nonnegative().default(1500),

  CHECKOUT_QUEUE_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),

  OTEL_ENABLED: z.coerce.boolean().default(true),
});

export type Env = z.infer<typeof envSchema>;

export const env: Env = envSchema.parse(process.env);
