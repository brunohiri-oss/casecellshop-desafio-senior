import pg from 'pg';
import { env } from '../config/env.js';
import { logger } from '../observability/logger.js';

const { Pool } = pg;

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on('error', (err) => {
  logger.error({ err }, 'unexpected pg pool error');
});

export async function pingDb(): Promise<boolean> {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch (err) {
    logger.error({ err }, 'db ping failed');
    return false;
  }
}

export async function closeDb(): Promise<void> {
  await pool.end();
}
