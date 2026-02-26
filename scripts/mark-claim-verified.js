#!/usr/bin/env node

const { Client } = require('pg');
const { loadEnv } = require('./load-env');

loadEnv();

const token = process.argv[2];
if (!token) {
  console.error('Usage: node scripts/mark-claim-verified.js <claim_token>');
  process.exit(1);
}

async function run() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    const updated = await client.query("update agent_claims set status='verified' where claim_token=$1", [token]);
    if (updated.rowCount === 0) {
      console.log('NOT_FOUND');
      return;
    }

    await client.query('update agent_claims set verified_at=now() where claim_token=$1 and verified_at is null', [token]);
    await client.query("update agent_claims set expires_at=now()+interval '24 hours' where claim_token=$1 and expires_at < now()", [token]);

    const claim = await client.query('select agent_id from agent_claims where claim_token=$1', [token]);
    const agentId = claim.rows[0].agent_id;
    await client.query('update agents set x_claim_verified_at=now() where id=$1 and x_claim_verified_at is null', [agentId]);

    const check = await client.query(
      'select a.id, a.x_claim_verified_at, c.claim_token, c.verification_code, c.status, c.verified_at from agents a join agent_claims c on c.agent_id=a.id where c.claim_token=$1',
      [token]
    );
    console.log(JSON.stringify(check.rows[0], null, 2));
  } finally {
    await client.end();
  }
}

run().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
