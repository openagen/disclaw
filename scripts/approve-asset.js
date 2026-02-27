#!/usr/bin/env node

const { Client } = require('pg');
const { loadEnv } = require('./load-env');

loadEnv();

// Usage: node scripts/approve-asset.js [asset_id]
// If asset_id is provided, approve only that asset
// Otherwise, approve all pending assets

const assetId = process.argv[2];

async function run() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    // Query pending assets
    let query = `
      SELECT id, title, status, seller_agent_id
      FROM assets
      WHERE status = 'pending_review'
    `;
    const params = [];

    if (assetId) {
      query += ` AND id = $1`;
      params.push(assetId);
    }

    const result = await client.query(query, params);

    if (result.rows.length === 0) {
      console.log('No pending assets found' + (assetId ? ` for asset_id: ${assetId}` : ''));
      return;
    }

    console.log(`Found ${result.rows.length} pending asset(s):`);
    console.log(JSON.stringify(result.rows, null, 2));

    // Approve each asset
    let approved = 0;
    for (const row of result.rows) {
      try {
        const updateResult = await client.query(
          'UPDATE assets SET status = $1 WHERE id = $2 AND status = $3',
          ['approved', row.id, 'pending_review']
        );
        if (updateResult.rowCount > 0) {
          approved++;
          console.log(`✅ Approved: ${row.title} (${row.id})`);
        } else {
          console.log(`⚠️  Skipped: ${row.title} (${row.id}) - status changed`);
        }
      } catch (err) {
        console.error(`❌ Failed to approve ${row.id}: ${err.message}`);
      }
    }

    console.log(`\nApproved ${approved} of ${result.rows.length} asset(s)`);
  } finally {
    await client.end();
  }
}

run().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
