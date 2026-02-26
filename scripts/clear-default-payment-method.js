#!/usr/bin/env node

const { Client } = require('pg');
const { loadEnv } = require('./load-env');

loadEnv();

const agentId = process.argv[2];
if (!agentId) {
  console.error('Usage: node scripts/clear-default-payment-method.js <agent_id>');
  process.exit(1);
}

async function run() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query('update agents set default_payment_method_id = null where id = $1', [agentId]);
    const q = await client.query(
      'select id, buyer_payment_mode, stripe_customer_id, default_payment_method_id from agents where id = $1',
      [agentId]
    );
    console.log(JSON.stringify(q.rows[0] ?? null, null, 2));
  } finally {
    await client.end();
  }
}

run().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
