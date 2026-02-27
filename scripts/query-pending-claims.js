#!/usr/bin/env node

const { Client } = require('pg');
const { loadEnv } = require('./load-env');

loadEnv();

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error('Missing DATABASE_URL');
  process.exit(1);
}

const client = new Client({ connectionString: databaseUrl });

(async () => {
  await client.connect();
  
  const result = await client.query(`
    SELECT COUNT(*) as count
    FROM agent_claims 
    WHERE status = 'pending' 
      AND expires_at > NOW()
  `);
  
  console.log('Pending x-claims:', result.rows[0].count);
  
  // Get details
  const details = await client.query(`
    SELECT id, agent_id, x_handle, verification_code, created_at, expires_at
    FROM agent_claims 
    WHERE status = 'pending' 
      AND expires_at > NOW()
    ORDER BY created_at DESC
  `);
  
  if (details.rows.length > 0) {
    console.log('\nDetails:');
    details.rows.forEach(row => {
      console.log(`  - ${row.id.slice(0,8)}... | agent: ${row.agent_id.slice(0,8)}... | @${row.x_handle} | code: ${row.verification_code} | created: ${row.created_at} | expires: ${row.expires_at}`);
    });
  }
  
  await client.end();
})().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
