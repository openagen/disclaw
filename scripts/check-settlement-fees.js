#!/usr/bin/env node

const { Client } = require('pg');
const { loadEnv } = require('./load-env');

loadEnv();

const platformFeeBps = Number(process.env.PLATFORM_FEE_BPS || 500);
const orderId = process.argv[2] || null;

async function run() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const where = orderId ? 'where o.id = $1' : '';
    const args = orderId ? [orderId] : [];
    const q = await client.query(
      `
      select
        o.id as order_id,
        o.amount,
        o.currency as order_currency,
        o.status as order_status,
        s.action,
        s.status as settlement_status,
        s.gross_amount_cents,
        s.stripe_fee_amount_cents,
        s.platform_fee_amount_cents,
        s.seller_transfer_amount_cents,
        s.net_amount_cents,
        s.created_at
      from orders o
      join settlements s on s.order_id = o.id
      ${where}
      order by s.created_at desc
      limit 20
    `,
      args
    );

    if (q.rows.length === 0) {
      console.log('NO_SETTLEMENT_ROWS');
      return;
    }

    const result = q.rows.map((r) => {
      const gross = Number(r.gross_amount_cents ?? 0);
      const storedPlatform = r.platform_fee_amount_cents === null ? null : Number(r.platform_fee_amount_cents);
      const storedSeller = r.seller_transfer_amount_cents === null ? null : Number(r.seller_transfer_amount_cents);
      const expectedPlatform = Math.round((gross * platformFeeBps) / 10000);
      const expectedSeller = gross - expectedPlatform;

      return {
        order_id: r.order_id,
        action: r.action,
        settlement_status: r.settlement_status,
        order_status: r.order_status,
        gross_amount_cents: gross,
        stripe_fee_amount_cents: r.stripe_fee_amount_cents === null ? null : Number(r.stripe_fee_amount_cents),
        platform_fee_amount_cents: storedPlatform,
        expected_platform_fee_amount_cents: expectedPlatform,
        platform_fee_match: storedPlatform === null ? null : storedPlatform === expectedPlatform,
        seller_transfer_amount_cents: storedSeller,
        expected_seller_transfer_amount_cents: storedSeller === null ? null : expectedSeller,
        seller_transfer_match: storedSeller === null ? null : storedSeller === expectedSeller,
        net_amount_cents: r.net_amount_cents === null ? null : Number(r.net_amount_cents),
        created_at: r.created_at
      };
    });

    console.log(JSON.stringify({ platform_fee_bps: platformFeeBps, rows: result }, null, 2));
  } finally {
    await client.end();
  }
}

run().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
