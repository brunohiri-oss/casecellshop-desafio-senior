import { pool, closeDb } from '../infra/db.js';
import { logger } from '../observability/logger.js';

const PRODUCTS = [
  { sku: 'CAP-IP15-CLR', name: 'Capinha iPhone 15 Transparente', price_cents: 4990, stock: 120 },
  { sku: 'CAP-IP15-BLK', name: 'Capinha iPhone 15 Preta', price_cents: 5990, stock: 80 },
  { sku: 'CAP-IP15-PRO-LTH', name: 'Capinha iPhone 15 Pro Couro', price_cents: 12990, stock: 30 },
  { sku: 'CAP-GAL-S24-CLR', name: 'Capinha Galaxy S24 Transparente', price_cents: 4490, stock: 150 },
  { sku: 'CAP-GAL-S24-BLU', name: 'Capinha Galaxy S24 Azul', price_cents: 5490, stock: 60 },
  { sku: 'CAP-IP14-CLR', name: 'Capinha iPhone 14 Transparente', price_cents: 3990, stock: 200 },
  { sku: 'CAP-MOTO-G84', name: 'Capinha Moto G84', price_cents: 2990, stock: 100 },
  { sku: 'CAP-XIAOMI-R13', name: 'Capinha Redmi 13', price_cents: 2490, stock: 90 },
  { sku: 'CAP-IP15-RARE', name: 'Capinha iPhone 15 Edição Limitada', price_cents: 19990, stock: 1 },
];

async function seed() {
  logger.info('seeding products');
  for (const p of PRODUCTS) {
    await pool.query(
      `INSERT INTO products (sku, name, price_cents, stock)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (sku) DO UPDATE SET
         name = EXCLUDED.name,
         price_cents = EXCLUDED.price_cents,
         stock = EXCLUDED.stock,
         version = products.version + 1,
         updated_at = now()`,
      [p.sku, p.name, p.price_cents, p.stock]
    );
  }
  logger.info({ count: PRODUCTS.length }, 'seed done');
}

seed()
  .then(() => closeDb())
  .then(() => process.exit(0))
  .catch((err) => {
    logger.fatal({ err }, 'seed failed');
    process.exit(1);
  });
