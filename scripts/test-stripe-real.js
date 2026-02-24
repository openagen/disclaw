#!/usr/bin/env node

const { createHash, randomUUID, sign } = require('crypto');
const { spawn, spawnSync } = require('child_process');
const readline = require('readline/promises');
const { stdin, stdout } = require('process');
const { Client } = require('pg');
const Stripe = require('stripe');
const { loadEnv } = require('./load-env');

loadEnv();

const base = process.env.TEST_BASE_URL || 'http://localhost:3000';
const databaseUrl = process.env.DATABASE_URL;
const adminToken = process.env.ADMIN_API_TOKEN;
const stripeSecretKey = process.env.STRIPE_SECRET_KEY;

if (!databaseUrl || !adminToken || !stripeSecretKey) {
  console.error('Missing required env: DATABASE_URL, ADMIN_API_TOKEN, STRIPE_SECRET_KEY');
  process.exit(1);
}

const stripe = new Stripe(stripeSecretKey);

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function isServerUp() {
  try {
    const r = await fetch(base);
    return r.ok || r.status > 0;
  } catch {
    return false;
  }
}

async function waitForServer(maxMs = 90000) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    if (await isServerUp()) return true;
    await sleep(500);
  }
  return false;
}

function runCmd(cmd, args) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', env: process.env });
  if (r.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} failed with code ${r.status}`);
  }
}

function sha256Hex(s) {
  return createHash('sha256').update(s).digest('hex');
}

function payload(method, path, ts, body) {
  return [method.toUpperCase(), path, String(ts), sha256Hex(body || '')].join('\n');
}

async function req(method, path, bodyObj, headers = {}) {
  const body = bodyObj ? JSON.stringify(bodyObj) : undefined;
  const r = await fetch(`${base}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...headers
    },
    body
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

async function registerAgent(name) {
  const r = await req('POST', '/api/v1/agents/register', {
    name,
    description: `${name}.local`
  });
  assert(r.status === 201, `register failed: ${r.status} ${JSON.stringify(r.json)}`);
  return {
    id: r.json.agent.id,
    name: r.json.agent.name,
    privateKey: r.json.agent.auth.private_key_pem
  };
}

async function signed(agent, method, path, bodyObj, customNonce) {
  const body = bodyObj ? JSON.stringify(bodyObj) : '';
  const ts = Math.floor(Date.now() / 1000);
  const nonce = customNonce || randomUUID();
  const sig = sign(null, Buffer.from(payload(method, path, ts, body)), agent.privateKey).toString('base64');

  return req(method, path, bodyObj, {
    'x-agent-id': agent.id,
    'x-agent-timestamp': String(ts),
    'x-agent-nonce': nonce,
    'x-agent-signature': sig
  });
}

async function admin(method, path, bodyObj) {
  return req(method, path, bodyObj, {
    authorization: `Bearer ${adminToken}`
  });
}

async function waitForAgentStatus(db, agentId, expected, timeoutMs = 15 * 60 * 1000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const q = await db.query('select status from agents where id = $1', [agentId]);
    const status = q.rows[0]?.status;
    if (status === expected) return;
    await new Promise((r) => setTimeout(r, 4000));
  }
  throw new Error(`timeout waiting for agent status=${expected}`);
}

async function waitForOrderStatus(db, orderId, expected, timeoutMs = 120000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const q = await db.query('select status from orders where id = $1', [orderId]);
    const status = q.rows[0]?.status;
    if (status === expected) return;
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`timeout waiting for order ${orderId} status=${expected}`);
}

async function run() {
  const rl = readline.createInterface({ input: stdin, output: stdout });
  const db = new Client({ connectionString: databaseUrl });
  await db.connect();
  let serverProc = null;
  let startedByScript = false;

  const created = { agentIds: [], assetIds: [], orderIds: [] };

  try {
    const up = await isServerUp();
    if (!up) {
      //runCmd('pnpm', ['build']);
      serverProc = spawn('pnpm', ['start', '-p', '3000'], {
        stdio: 'inherit',
        env: process.env
      });
      startedByScript = true;

      const ready = await waitForServer(90000);
      assert(ready, `server not reachable after startup: ${base}`);
    }

    console.log('STEP 1/8 注册 seller/buyer agents');
    const seller = await registerAgent(`SellerReal-${Date.now()}`);
    const buyer = await registerAgent(`BuyerReal-${Date.now()}`);
    created.agentIds.push(seller.id, buyer.id);

    console.log('STEP 2/8 调用 /sellers/apply 获取 onboarding URL');
    const apply = await signed(seller, 'POST', '/api/v1/sellers/apply');
    assert(apply.status === 200, `sellers/apply failed: ${apply.status} ${JSON.stringify(apply.json)}`);
    const onboardingUrl = apply.json.stripe_onboarding_url;
    assert(onboardingUrl, 'missing stripe_onboarding_url');

    console.log('\n=== 复制这个 URL 到浏览器并完成 KYC ===');
    console.log(onboardingUrl);
    console.log('======================================\n');

    await rl.question('完成浏览器 KYC 后按回车继续... ');

    console.log('STEP 3/8 等待 webhook 把 seller 状态更新到 kyc_verified');
    await waitForAgentStatus(db, seller.id, 'kyc_verified');

    console.log('STEP 4/8 管理员审核 seller -> seller_approved');
    const reviewSeller = await admin('PATCH', `/api/v1/admin/sellers/${seller.id}/review`, { decision: 'approved' });
    assert(
      reviewSeller.status === 200,
      `admin seller review failed: ${reviewSeller.status} ${JSON.stringify(reviewSeller.json)}`
    );

    console.log('STEP 5/8 seller 发布并上架资产');
    const createAsset = await signed(seller, 'POST', '/api/v1/assets', {
      title: 'Real Stripe Digital Asset',
      description: 'Real Stripe integration flow',
      asset_type: 'digital',
      price: 9.99,
      currency: 'USD',
      inventory: 20
    });
    assert(createAsset.status === 201, `create asset failed: ${createAsset.status} ${JSON.stringify(createAsset.json)}`);
    const assetId = createAsset.json.asset.id;
    created.assetIds.push(assetId);

    const submit = await signed(seller, 'POST', `/api/v1/assets/${assetId}/submit-review`);
    assert(submit.status === 200, `submit asset review failed: ${submit.status}`);

    const approveAsset = await admin('PATCH', `/api/v1/assets/${assetId}/review`, { decision: 'approved' });
    assert(approveAsset.status === 200, `approve asset failed: ${approveAsset.status}`);

    console.log('STEP 6/8 buyer 下单并支付（真实 PaymentIntent + confirm）');
    const createOrder = await signed(buyer, 'POST', '/api/v1/orders', {
      asset_id: assetId,
      confirmation_mode: 'auto_timeout_confirm'
    });
    assert(createOrder.status === 201, `create order failed: ${createOrder.status} ${JSON.stringify(createOrder.json)}`);
    const orderId = createOrder.json.order.id;
    created.orderIds.push(orderId);

    const pay = await signed(buyer, 'POST', `/api/v1/orders/${orderId}/pay`);
    assert(pay.status === 200, `pay failed: ${pay.status} ${JSON.stringify(pay.json)}`);
    const paymentIntentId = pay.json.payment_intent_id;

    await stripe.paymentIntents.confirm(paymentIntentId, {
      payment_method: 'pm_card_visa'
    });

    await waitForOrderStatus(db, orderId, 'paid');

    console.log('STEP 7/8 buyer 确认收货，触发 capture');
    const confirm = await signed(buyer, 'POST', `/api/v1/orders/${orderId}/confirm`);
    assert(confirm.status === 200, `order confirm failed: ${confirm.status} ${JSON.stringify(confirm.json)}`);

    const settlementCapture = await db.query(
      "select count(*)::int as n from settlements where order_id=$1 and action='capture' and status='succeeded'",
      [orderId]
    );
    assert(settlementCapture.rows[0].n > 0, 'capture settlement not found');

    console.log('STEP 8/8 争议退款链路（buyer win）');
    const createOrder2 = await signed(buyer, 'POST', '/api/v1/orders', {
      asset_id: assetId,
      confirmation_mode: 'auto_timeout_confirm'
    });
    assert(createOrder2.status === 201, `create order2 failed: ${createOrder2.status}`);
    const order2 = createOrder2.json.order.id;
    created.orderIds.push(order2);

    const pay2 = await signed(buyer, 'POST', `/api/v1/orders/${order2}/pay`);
    assert(pay2.status === 200, `pay2 failed: ${pay2.status}`);

    await stripe.paymentIntents.confirm(pay2.json.payment_intent_id, {
      payment_method: 'pm_card_visa'
    });
    await waitForOrderStatus(db, order2, 'paid');

    const dispute = await signed(buyer, 'POST', `/api/v1/orders/${order2}/dispute`, {
      reason: 'integration test refund path'
    });
    assert(dispute.status === 201, `dispute failed: ${dispute.status} ${JSON.stringify(dispute.json)}`);

    const resolve = await admin('PATCH', `/api/v1/admin/disputes/${order2}/resolve`, {
      decision: 'buyer',
      reason: 'integration test resolved for buyer'
    });
    assert(resolve.status === 200, `resolve buyer failed: ${resolve.status} ${JSON.stringify(resolve.json)}`);

    const settlementRefund = await db.query(
      "select count(*)::int as n from settlements where order_id=$1 and action in ('refund','cancel_authorization') and status='succeeded'",
      [order2]
    );
    assert(settlementRefund.rows[0].n > 0, 'refund/cancel_authorization settlement not found');

    console.log('\nREAL_STRIPE_FLOW_PASS');
    console.log('- sellers/apply onboarding + browser KYC + webhook kyc_verified');
    console.log('- orders/:id/pay real PaymentIntent confirm -> paid');
    console.log('- orders/:id/confirm -> capture settlement');
    console.log('- dispute resolve buyer -> refund/cancel_authorization settlement');
  } finally {
    await rl.close();

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

    if (startedByScript && serverProc && !serverProc.killed) {
      serverProc.kill('SIGINT');
    }
  }
}

run().catch((err) => {
  console.error('REAL_STRIPE_FLOW_FAIL');
  console.error(err.message || err);
  process.exit(1);
});
