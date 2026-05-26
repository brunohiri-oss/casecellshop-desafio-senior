import type { PoolClient } from 'pg';
import { pool } from '../infra/db.js';

export type IdempotencyStatus = 'in_progress' | 'complete';

export interface IdempotencyRow {
  key: string;
  request_hash: string;
  order_id: string | null;
  status: IdempotencyStatus;
  response_body: unknown;
  response_code: number | null;
  created_at: Date;
  expires_at: Date;
}

export type ClaimOutcome =
  | { outcome: 'claimed' }
  | { outcome: 'replay'; existing: IdempotencyRow }
  | { outcome: 'in_progress'; existing: IdempotencyRow }
  | { outcome: 'hash_mismatch'; existing: IdempotencyRow };

/**
 * Tenta inserir a chave em 'in_progress'. Se já existir:
 *  - mesma hash + complete → replay (cliente recebe a mesma resposta).
 *  - mesma hash + in_progress → outra request da MESMA operação está rolando.
 *  - hash diferente → cliente reusou a key com payload diferente (erro).
 */
export async function claimIdempotencyKey(params: {
  key: string;
  requestHash: string;
  ttlHours: number;
}): Promise<ClaimOutcome> {
  const expiresAt = new Date(Date.now() + params.ttlHours * 3_600_000);
  const inserted = await pool.query(
    `INSERT INTO idempotency_keys (key, request_hash, status, expires_at)
     VALUES ($1, $2, 'in_progress', $3)
     ON CONFLICT (key) DO NOTHING`,
    [params.key, params.requestHash, expiresAt]
  );
  if (inserted.rowCount === 1) {
    return { outcome: 'claimed' };
  }
  const existingRes = await pool.query<IdempotencyRow>(
    'SELECT * FROM idempotency_keys WHERE key = $1',
    [params.key]
  );
  const existing = existingRes.rows[0];
  if (!existing) {
    // race extremamente improvável: chave foi expirada/deletada entre nosso insert e select
    return { outcome: 'claimed' };
  }
  if (existing.request_hash !== params.requestHash) {
    return { outcome: 'hash_mismatch', existing };
  }
  if (existing.status === 'complete') {
    return { outcome: 'replay', existing };
  }
  return { outcome: 'in_progress', existing };
}

export async function completeIdempotencyTx(
  client: PoolClient,
  params: { key: string; orderId: string | null; responseBody: unknown; responseCode: number }
): Promise<void> {
  await client.query(
    `UPDATE idempotency_keys
     SET status = 'complete', order_id = $1, response_body = $2::jsonb, response_code = $3
     WHERE key = $4`,
    [params.orderId, JSON.stringify(params.responseBody), params.responseCode, params.key]
  );
}

export async function completeIdempotency(params: {
  key: string;
  orderId: string | null;
  responseBody: unknown;
  responseCode: number;
}): Promise<void> {
  await pool.query(
    `UPDATE idempotency_keys
     SET status = 'complete', order_id = $1, response_body = $2::jsonb, response_code = $3
     WHERE key = $4`,
    [params.orderId, JSON.stringify(params.responseBody), params.responseCode, params.key]
  );
}

export async function releaseIdempotencyOnError(key: string): Promise<void> {
  // Se algo deu errado durante o processamento e queremos permitir reprocesso,
  // deletamos a chave. Política aqui: deletar para liberar nova tentativa.
  await pool.query('DELETE FROM idempotency_keys WHERE key = $1 AND status = $2', [
    key,
    'in_progress',
  ]);
}
