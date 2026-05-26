import type { PoolClient } from 'pg';
import { pool } from '../infra/db.js';

export interface OutboxEvent {
  id: string;
  event_type: string;
  payload: unknown;
  status: 'pending' | 'published' | 'failed';
  created_at: Date;
  published_at: Date | null;
}

/**
 * Insere evento no outbox na MESMA transação do agregado principal.
 * Garante "no message lost": se a transação comita, o evento existe;
 * se rollback, evento também é descartado.
 */
export async function insertOutboxEventTx(
  client: PoolClient,
  params: { eventType: string; payload: unknown }
): Promise<string> {
  const res = await client.query<{ id: string }>(
    `INSERT INTO outbox_events (event_type, payload, status)
     VALUES ($1, $2::jsonb, 'pending')
     RETURNING id::text`,
    [params.eventType, JSON.stringify(params.payload)]
  );
  return res.rows[0]!.id;
}

export async function markOutboxPublished(id: string): Promise<void> {
  await pool.query(
    `UPDATE outbox_events SET status = 'published', published_at = now() WHERE id = $1`,
    [id]
  );
}
