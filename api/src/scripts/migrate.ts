import { pool, closeDb } from '../infra/db.js';
import { logger } from '../observability/logger.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS products (
  sku         TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
  stock       INTEGER NOT NULL CHECK (stock >= 0),
  version     INTEGER NOT NULL DEFAULT 1,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS orders (
  id              UUID PRIMARY KEY,
  items           JSONB NOT NULL,
  status          TEXT NOT NULL CHECK (status IN ('pending','confirmed','failed')),
  idempotency_key UUID NOT NULL,
  erp_invoice_id  TEXT,
  failed_reason   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS orders_status_created_idx ON orders (status, created_at);
CREATE INDEX IF NOT EXISTS orders_idempotency_key_idx ON orders (idempotency_key);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  key            UUID PRIMARY KEY,
  request_hash   TEXT NOT NULL,
  order_id       UUID,
  status         TEXT NOT NULL CHECK (status IN ('in_progress','complete')),
  response_body  JSONB,
  response_code  INTEGER,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at     TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idempotency_expires_idx ON idempotency_keys (expires_at);

CREATE TABLE IF NOT EXISTS outbox_events (
  id           BIGSERIAL PRIMARY KEY,
  event_type   TEXT NOT NULL,
  payload      JSONB NOT NULL,
  status       TEXT NOT NULL CHECK (status IN ('pending','published','failed')) DEFAULT 'pending',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS outbox_status_created_idx ON outbox_events (status, created_at);
`;

async function migrate() {
  logger.info('running migrations');
  await pool.query(SCHEMA);
  logger.info('migrations done');
}

migrate()
  .then(() => closeDb())
  .then(() => process.exit(0))
  .catch((err) => {
    logger.fatal({ err }, 'migration failed');
    process.exit(1);
  });
