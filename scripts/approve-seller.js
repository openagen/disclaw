#!/usr/bin/env node

const { Client } = require('pg');
const { loadEnv } = require('./load-env');

loadEnv();

// Usage: node scripts/approve-seller.js [agent_id]
// If agent_id is provided, approve only that seller
// Otherwise, approve all pending sellers

const agentId = process.argv[2];

async function run() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    // Query pending sellers
    let query = `
      SELECT s.agent_id, s.review_status, a.status as agent_status, a.name
      FROM sellers s
      JOIN agents a ON s.agent_id = a.id
      WHERE s.review_status = 'pending'
    `;
    const params = [];

    if (agentId) {
      query += ` AND s.agent_id = $1`;
      params.push(agentId);
    }

    const result = await client.query(query, params);

    if (result.rows.length === 0) {
      console.log('No pending sellers found' + (agentId ? ` for agent_id: ${agentId}` : ''));
      return;
    }

    console.log(`Found ${result.rows.length} pending seller(s):`);
    console.log(JSON.stringify(result.rows, null, 2));

    // Approve each seller
    let approved = 0;
    for (const row of result.rows) {
      await client.query('BEGIN');
      try {
        await client.query(
          'UPDATE sellers SET review_status = $1 WHERE agent_id = $2',
          ['approved', row.agent_id]
        );
        await client.query(
          "UPDATE agents SET status = 'seller_approved' WHERE id = $1",
          [row.agent_id]
        );
        await client.query('COMMIT');
        approved++;
        console.log(`✅ Approved: ${row.name} (${row.agent_id})`);
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`❌ Failed to approve ${row.agent_id}: ${err.message}`);
      }
    }

    console.log(`\nApproved ${approved} of ${result.rows.length} seller(s)`);
  } finally {
    await client.end();
  }
}

run().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
