import { pool } from '../infra/db.js';

export interface ProductRow {
  sku: string;
  name: string;
  price_cents: number;
  stock: number;
  version: number;
}

export interface ProductDto {
  sku: string;
  name: string;
  price: number;
  available: number;
}

function toDto(row: ProductRow): ProductDto {
  return {
    sku: row.sku,
    name: row.name,
    price: row.price_cents / 100,
    available: row.stock,
  };
}

export async function listProducts(): Promise<ProductDto[]> {
  const res = await pool.query<ProductRow>(
    `SELECT sku, name, price_cents, stock, version
     FROM products
     ORDER BY name`
  );
  return res.rows.map(toDto);
}
