# Payments and Compliance (Stripe Connect)

## Model

Use:
1. Stripe Connect Express for seller accounts.
2. Destination Charges for buyer payment routing.
3. Platform fee (`application_fee_amount`) for commission.

Avoid:
1. Internal wallet balances in MVP.
2. Non-Stripe rails in MVP.

## Seller Onboarding

1. Agent calls `POST /api/v1/sellers/apply`.
2. Platform creates/reuses Stripe account.
3. Platform generates onboarding link.
4. Agent notifies its human operator to complete KYC.
5. Stripe sends webhook `account.updated`.
6. If `charges_enabled=true` and `payouts_enabled=true`, set agent to `kyc_verified`.
7. Require manual admin review before `seller_approved`.

## PaymentIntent Creation

At `/orders/:id/pay`:
1. Compute amount server-side from asset/order snapshot.
2. Buyer payment mode decides path:
   - `bootstrap_required`: return Stripe Checkout URL for human authorization.
   - `mit_enabled`: try MIT (`off_session`) first.
   - `human_every_time`: always return Stripe Checkout URL.
3. For Checkout path:
   - Create/reuse Stripe Customer for buyer (`agents.stripe_customer_id`).
   - Create Checkout Session with `payment_intent_data`:
     - `capture_method=manual`
     - `setup_future_usage=off_session`
     - `application_fee_amount`
     - `transfer_data.destination`
4. For MIT path:
   - Require `customer + payment_method + off_session + confirm`.
   - Use `agents.default_payment_method_id` as default source when caller does not pass one.
5. If MIT returns `requires_action` or `requires_payment_method`, return actionable `human_assistance` payload.
6. Save `stripe_payment_intent_id` on order when PI exists.
7. Handle idempotency key based on order id + payer context.

## Payment Method Persistence

After successful checkout/payment webhook:
1. Resolve buyer Stripe Customer id.
2. Attach payment method to that customer.
3. Set customer default payment method.
4. Persist to `agents.default_payment_method_id`.
5. Switch buyer mode to `mit_enabled`.

Fallback policy:
1. If payment method binding indicates cross-customer conflict or failure, set buyer mode to `human_every_time`.

## Webhook Requirements

1. Verify `Stripe-Signature` header.
2. Reject unverified events.
3. Store processed event ids to prevent duplicate side effects.
4. Handle at minimum:
   - `account.updated`
   - `checkout.session.completed`
   - `checkout.session.expired`
   - `payment_intent.amount_capturable_updated`
   - `payment_intent.succeeded`
   - `payment_intent.payment_failed`
   - `charge.dispute.created` (if enabled in account)

Expected side effects:
1. `checkout.session.completed`: set order `paid`, persist PI id, bind default payment method, buyer mode -> `mit_enabled`.
2. `checkout.session.expired`: set order `cancelled`, buyer mode -> `human_every_time`.
3. `payment_intent.amount_capturable_updated`: set order `paid`, bind default payment method.
4. `payment_intent.payment_failed`: set order `cancelled`, buyer mode -> `human_every_time`.

## Escrow Release Logic

Release funds only when order reaches:
1. `confirmed`, or
2. `auto_confirmed` by timeout cron.

Block release when:
1. Order is `disputed`.
2. Seller becomes `suspended`.
3. Compliance hold is active.

## Refund and Dispute

1. Support manual refund decisions during dispute resolution.
2. Keep immutable audit trail of who triggered refund/release.
3. Mirror Stripe dispute status into internal dispute state when applicable.

## Accounting Fields

Store settlement fields for reconciliation:
1. `gross_amount_cents`
2. `stripe_fee_amount_cents`
3. `platform_fee_amount_cents`
4. `seller_transfer_amount_cents`
5. `platform_net_profit_cents = platform_fee_amount_cents - stripe_fee_amount_cents`

Interpretation:
1. Destination charge transfer can show full amount in transfer logs.
2. Platform net profit should always use `platform_net_profit_cents`, not transfer amount alone.

## Security Controls

1. Store API secrets in environment manager, never in source.
2. Log Stripe request ids for reconciliation.
3. Keep least-privilege keys for webhook and server operations.
