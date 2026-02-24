#!/usr/bin/env node

const { sign, createHash, randomUUID } = require('crypto');
const { Client } = require('pg');
const { loadEnv } = require('./load-env');

loadEnv();

const base = process.env.TEST_BASE_URL || 'http://localhost:3000';
const databaseUrl = process.env.DATABASE_URL;
const adminToken = process.env.ADMIN_API_TOKEN;

if (!databaseUrl || !adminToken) {
  console.error('Missing required env: DATABASE_URL, ADMIN_API_TOKEN');
  process.exit(1);
}

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

function sha256Hex(s) {
  return createHash('sha256').update(s).digest('hex');
}

function signingPayload(method, path, ts, body) {
  return [method.toUpperCase(), path, String(ts), sha256Hex(body || '')].join('\n');
}

async function register(name) {
  const r = await fetch(`${base}/api/v1/agents/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, description: `${name}.local` })
  });

  const j = await r.json();
  assert(r.status === 201, `register failed ${r.status} ${JSON.stringify(j)}`);

  return {
    id: j.agent.id,
    privateKey: j.agent.auth.private_key_pem
  };
}

async function signed(agent, method, path, bodyObj, nonce) {
  const body = bodyObj ? JSON.stringify(bodyObj) : '';
  const ts = Math.floor(Date.now() / 1000);
  const usedNonce = nonce || randomUUID();
  const payload = signingPayload(method, path, ts, body);
  const signature = sign(null, Buffer.from(payload), agent.privateKey).toString('base64');

  const r = await fetch(`${base}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-agent-id': agent.id,
      'x-agent-timestamp': String(ts),
      'x-agent-nonce': usedNonce,
      'x-agent-signature': signature
    },
    body: body || undefined
  });

  const text = await r.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }

  return { status: r.status, json };
}

async function run() {
  const db = new Client({ connectionString: databaseUrl });
  await db.connect();

  const created = {
    agentIds: [],
    assetIds: [],
    orderIds: []
  };

  try {
    const buyer = await register(`Buyer-${Date.now()}`);
    created.agentIds.push(buyer.id);

    const s1 = await signed(buyer, 'GET', '/api/v1/agents/status');
    assert(s1.status === 200, `status failed ${s1.status}`);

    const replayNonce = randomUUID();
    const s2 = await signed(buyer, 'GET', '/api/v1/agents/status', null, replayNonce);
    const s3 = await signed(buyer, 'GET', '/api/v1/agents/status', null, replayNonce);
    assert(s2.status === 200 && s3.status === 401, `replay check failed ${s2.status}/${s3.status}`);

    const seller = await register(`Seller-${Date.now()}`);
    created.agentIds.push(seller.id);

    await db.query(
      `insert into sellers(agent_id, stripe_account_id, review_status)
       values ($1, $2, 'approved')
       on conflict (agent_id) do update
       set stripe_account_id = excluded.stripe_account_id, review_status = 'approved'`,
      [seller.id, `acct_test_${seller.id.slice(0, 8)}`]
    );

    await db.query(`update agents set status='seller_approved' where id=$1`, [seller.id]);

    const a1 = await signed(seller, 'POST', '/api/v1/assets', {
      title: 'Digital Pack',
      description: 'demo',
      asset_type: 'digital',
      price: 12.34,
      currency: 'USD',
      inventory: 10
    });
    assert(a1.status === 201, `asset create failed ${a1.status} ${JSON.stringify(a1.json)}`);
    const assetId = a1.json.asset.id;
    created.assetIds.push(assetId);

    const a2 = await signed(seller, 'POST', `/api/v1/assets/${assetId}/submit-review`);
    assert(a2.status === 200, `submit review failed ${a2.status}`);

    const approve = await fetch(`${base}/api/v1/assets/${assetId}/review`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({ decision: 'approved' })
    });
    assert(approve.status === 200, `admin approve asset failed ${approve.status} ${await approve.text()}`);

    const o1 = await signed(buyer, 'POST', '/api/v1/orders', {
      asset_id: assetId,
      confirmation_mode: 'auto_timeout_confirm'
    });
    assert(o1.status === 201, `create order failed ${o1.status} ${JSON.stringify(o1.json)}`);
    const orderId = o1.json.order.id;
    created.orderIds.push(orderId);

    await db.query(`update orders set status='paid' where id=$1`, [orderId]);

    const d1 = await signed(buyer, 'POST', `/api/v1/orders/${orderId}/dispute`, {
      reason: 'not delivered for test'
    });
    assert(d1.status === 201, `dispute failed ${d1.status} ${JSON.stringify(d1.json)}`);

    const list = await fetch(`${base}/api/v1/admin/disputes`, {
      headers: { authorization: `Bearer ${adminToken}` }
    });
    assert(list.status === 200, `list disputes failed ${list.status}`);

    const resolve = await fetch(`${base}/api/v1/admin/disputes/${orderId}/resolve`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({ decision: 'reject', reason: 'insufficient proof' })
    });
    assert(resolve.status === 200, `resolve dispute failed ${resolve.status} ${await resolve.text()}`);

    console.log('API_SMOKE_PASS');
    console.log('- agent register + signed status');
    console.log('- nonce replay protection');
    console.log('- asset create/submit/admin approve');
    console.log('- order create + dispute + admin resolve');
  } finally {
    if (created.orderIds.length > 0) {
      await db.query('delete from disputes where order_id = any($1::uuid[])', [created.orderIds]);
      await db.query('delete from settlements where order_id = any($1::uuid[])', [created.orderIds]);
      await db.query('delete from orders where id = any($1::uuid[])', [created.orderIds]);
    }

    if (created.assetIds.length > 0) {
      await db.query('delete from assets where id = any($1::uuid[])', [created.assetIds]);
    }

    if (created.agentIds.length > 0) {
      await db.query('delete from sellers where agent_id = any($1::uuid[])', [created.agentIds]);
      await db.query('delete from auth_nonces where agent_id = any($1::uuid[])', [created.agentIds]);
      await db.query('delete from agents where id = any($1::uuid[])', [created.agentIds]);
    }

    await db.end();
  }
}

run().catch((err) => {
  console.error('API_SMOKE_FAIL');
  console.error(err.message || err);
  process.exit(1);
});
