#!/usr/bin/env node

const Stripe = require('stripe');
const { Client } = require('pg');
const { loadEnv } = require('./load-env');

loadEnv();

const baseUrl = process.env.TEST_BASE_URL || 'http://localhost:3000';
const webhookPath = '/api/v1/webhooks/stripe';
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
const databaseUrl = process.env.DATABASE_URL;

if (!webhookSecret || !stripeSecretKey || !databaseUrl) {
  console.error('Missing required env: STRIPE_WEBHOOK_SECRET, STRIPE_SECRET_KEY, DATABASE_URL');
  process.exit(1);
}

const stripe = new Stripe(stripeSecretKey);

function assert(cond, message) {
  if (!cond) {
    throw new Error(message);
  }
}

async function postWebhook(event) {
  const payload = JSON.stringify(event);
  const signature = stripe.webhooks.generateTestHeaderString({
    payload,
    secret: webhookSecret,
    timestamp: Math.floor(Date.now() / 1000)
  });

  const res = await fetch(`${baseUrl}${webhookPath}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'stripe-signature': signature
    },
    body: payload
  });

  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text };
  }

  assert(res.status === 200, `Webhook failed (${event.type}): ${res.status} ${JSON.stringify(body)}`);
}

function id(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
}

async function insertAgent(client, name, status) {
  const publicKey = `-----BEGIN PUBLIC KEY-----\\nTEST-${name}\\n-----END PUBLIC KEY-----`;
  const q = await client.query(
    `insert into agents (name, description, public_key_pem, status)
     values ($1, $2, $3, $4)
     returning id`,
    [name, `${name}.local`, publicKey, status]
  );
  return q.rows[0].id;
}

async function insertSeller(client, agentId, stripeAccountId, reviewStatus = 'approved') {
  await client.query(
    `insert into sellers (agent_id, stripe_account_id, review_status)
     values ($1, $2, $3)
     on conflict (agent_id) do update set stripe_account_id = excluded.stripe_account_id, review_status = excluded.review_status`,
    [agentId, stripeAccountId, reviewStatus]
  );
}

async function insertAsset(client, sellerAgentId) {
  const q = await client.query(
    `insert into assets (seller_agent_id, title, description, asset_type, price, currency, inventory, status)
     values ($1, $2, $3, $4, $5, 'USD', 100, 'approved')
     returning id`,
    [sellerAgentId, id('WebhookAsset'), 'fixture', 'digital', '19.99']
  );
  return q.rows[0].id;
}

async function insertOrder(client, buyerAgentId, sellerAgentId, assetId, paymentIntentId, status = 'created') {
  const q = await client.query(
    `insert into orders (
      buyer_agent_id, seller_agent_id, asset_id, amount, currency,
      stripe_payment_intent_id, status, confirmation_mode, confirm_deadline
     ) values ($1, $2, $3, $4, 'USD', $5, $6, 'auto_timeout_confirm', now() + interval '1 day')
     returning id`,
    [buyerAgentId, sellerAgentId, assetId, '19.99', paymentIntentId, status]
  );
  return q.rows[0].id;
}

async function getOrderStatus(client, orderId) {
  const q = await client.query('select status from orders where id = $1', [orderId]);
  return q.rows[0]?.status;
}

async function run() {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  const created = {
    agentIds: [],
    assetIds: [],
    orderIds: []
  };

  try {
    const buyer = await insertAgent(client, id('buyer'), 'registered');
    const seller = await insertAgent(client, id('seller'), 'seller_approved');
    created.agentIds.push(buyer, seller);

    const sellerAccountId = id('acct_webhook');
    await insertSeller(client, seller, sellerAccountId, 'approved');

    const assetId = await insertAsset(client, seller);
    created.assetIds.push(assetId);

    const pi1 = id('pi_webhook_paid');
    const order1 = await insertOrder(client, buyer, seller, assetId, pi1, 'created');
    created.orderIds.push(order1);

    await postWebhook({
      id: id('evt_amt_capturable'),
      object: 'event',
      type: 'payment_intent.amount_capturable_updated',
      data: { object: { id: pi1, object: 'payment_intent' } }
    });

    let status = await getOrderStatus(client, order1);
    assert(status === 'paid', `Expected order1=paid, got ${status}`);

    await postWebhook({
      id: id('evt_pi_succeeded'),
      object: 'event',
      type: 'payment_intent.succeeded',
      data: { object: { id: pi1, object: 'payment_intent' } }
    });

    status = await getOrderStatus(client, order1);
    assert(status === 'confirmed', `Expected order1=confirmed, got ${status}`);

    const pi2 = id('pi_webhook_failed');
    const order2 = await insertOrder(client, buyer, seller, assetId, pi2, 'created');
    created.orderIds.push(order2);

    await postWebhook({
      id: id('evt_pi_failed'),
      object: 'event',
      type: 'payment_intent.payment_failed',
      data: { object: { id: pi2, object: 'payment_intent' } }
    });

    status = await getOrderStatus(client, order2);
    assert(status === 'cancelled', `Expected order2=cancelled, got ${status}`);

    const pi3 = id('pi_webhook_dispute');
    const order3 = await insertOrder(client, buyer, seller, assetId, pi3, 'confirmed');
    created.orderIds.push(order3);

    const evtDispute = {
      id: id('evt_charge_dispute'),
      object: 'event',
      type: 'charge.dispute.created',
      data: {
        object: {
          id: id('dp_'),
          object: 'dispute',
          payment_intent: pi3,
          reason: 'fraudulent'
        }
      }
    };

    await postWebhook(evtDispute);
    status = await getOrderStatus(client, order3);
    assert(status === 'disputed', `Expected order3=disputed, got ${status}`);

    const dCount = await client.query('select count(*)::int as n from disputes where order_id = $1', [order3]);
    assert(dCount.rows[0].n === 1, `Expected 1 dispute row, got ${dCount.rows[0].n}`);

    await postWebhook(evtDispute);
    const dCount2 = await client.query('select count(*)::int as n from disputes where order_id = $1', [order3]);
    assert(dCount2.rows[0].n === 1, `Expected idempotent dispute count=1, got ${dCount2.rows[0].n}`);

    const kycAgent = await insertAgent(client, id('kyc_agent'), 'pending_kyc');
    created.agentIds.push(kycAgent);
    const kycAccount = id('acct_kyc');
    await insertSeller(client, kycAgent, kycAccount, 'pending');

    await postWebhook({
      id: id('evt_account_updated'),
      object: 'event',
      type: 'account.updated',
      data: {
        object: {
          id: kycAccount,
          object: 'account',
          charges_enabled: true,
          payouts_enabled: true
        }
      }
    });

    const kycStatus = await client.query('select status from agents where id = $1', [kycAgent]);
    assert(kycStatus.rows[0].status === 'kyc_verified', `Expected kyc_verified, got ${kycStatus.rows[0].status}`);

    console.log('WEBHOOK_E2E_PASS');
    console.log('- payment_intent.amount_capturable_updated: created -> paid');
    console.log('- payment_intent.succeeded: paid -> confirmed');
    console.log('- payment_intent.payment_failed: created -> cancelled');
    console.log('- charge.dispute.created: dispute row + order -> disputed + idempotent resend');
    console.log('- account.updated(charges/payouts enabled): pending_kyc -> kyc_verified');
  } finally {
    if (created.orderIds.length > 0) {
      await client.query('delete from disputes where order_id = any($1::uuid[])', [created.orderIds]);
      await client.query('delete from settlements where order_id = any($1::uuid[])', [created.orderIds]);
      await client.query('delete from orders where id = any($1::uuid[])', [created.orderIds]);
    }

    if (created.assetIds.length > 0) {
      await client.query('delete from assets where id = any($1::uuid[])', [created.assetIds]);
    }

    if (created.agentIds.length > 0) {
      await client.query('delete from sellers where agent_id = any($1::uuid[])', [created.agentIds]);
      await client.query('delete from auth_nonces where agent_id = any($1::uuid[])', [created.agentIds]);
      await client.query('delete from agents where id = any($1::uuid[])', [created.agentIds]);
    }

    await client.end();
  }
}

run().catch((err) => {
  console.error('WEBHOOK_E2E_FAIL');
  console.error(err.message || err);
  process.exit(1);
});
