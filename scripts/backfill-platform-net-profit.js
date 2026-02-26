#!/usr/bin/env node

const { Client } = require('pg');
const { loadEnv } = require('./load-env');

loadEnv();

async function run() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const r = await client.query(`
      update settlements
      set platform_net_profit_cents = platform_fee_amount_cents - stripe_fee_amount_cents
      where platform_net_profit_cents is null
        and platform_fee_amount_cents is not null
        and stripe_fee_amount_cents is not null
    `);
    console.log(`UPDATED_ROWS=${r.rowCount}`);
  } finally {
    await client.end();
  }
}

run().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
