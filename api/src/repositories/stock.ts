import type { PoolClient } from 'pg';

export interface CheckoutItem {
  sku: string;
  quantity: number;
}

export type ReserveResult =
  | { ok: true }
  | { ok: false; reason: 'insufficient_stock' | 'unknown_sku'; sku: string };

/**
 * Reserva estoque para todos os itens de forma atômica dentro da transação.
 * Usa atomic conditional update: a condição (stock >= qty) é avaliada DENTRO
 * da mesma operação que decrementa, eliminando a race condition do padrão
 * SELECT-then-UPDATE. Se qualquer item falhar, a transação é abortada pelo
 * caller (rollback restaura todos os decrementos parciais).
 */
export async function reserveStockTx(
  client: PoolClient,
  items: CheckoutItem[]
): Promise<ReserveResult> {
  for (const item of items) {
    const res = await client.query<{ stock: number }>(
      `UPDATE products
       SET stock = stock - $1, updated_at = now()
       WHERE sku = $2 AND stock >= $1
       RETURNING stock`,
      [item.quantity, item.sku]
    );
    if (res.rowCount === 0) {
      const exists = await client.query<{ sku: string }>(
        'SELECT sku FROM products WHERE sku = $1',
        [item.sku]
      );
      return {
        ok: false,
        reason: exists.rowCount === 0 ? 'unknown_sku' : 'insufficient_stock',
        sku: item.sku,
      };
    }
  }
  return { ok: true };
}
