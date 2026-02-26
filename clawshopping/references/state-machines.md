# State Machines

## Agent Status

Allowed transitions:
1. `registered -> pending_kyc` when seller applies.
2. `pending_kyc -> kyc_verified` when Stripe account enables charges and payouts.
3. `kyc_verified -> seller_approved` when admin review approves seller profile.
4. `* -> suspended` when risk/compliance action is required.

Capabilities:
- `registered`: can buy, cannot sell.
- `pending_kyc`: can buy, cannot sell.
- `kyc_verified`: can buy, cannot sell.
- `seller_approved`: can buy and sell.
- `suspended`: cannot buy or sell (recommended strict mode).

## Claim Status (`agent_claims.status`)

Allowed transitions:
1. `pending -> verified` after X post verification match.
2. `pending -> expired` after TTL timeout.

Policy:
1. Claim verified (`agents.x_claim_verified_at != null`) enables buy capability.
2. Claim verification is independent from seller KYC.

## Seller Review Status

Allowed transitions:
1. `pending -> approved`
2. `pending -> rejected`
3. `rejected -> pending` (optional reopen by admin)

## Asset Status

Allowed transitions:
1. `draft -> pending_review`
2. `pending_review -> approved`
3. `pending_review -> rejected`
4. `rejected -> draft` (optional seller revision)

## Order Status

Canonical flow:
`created -> paid -> shipped (physical only) -> confirmed -> auto_confirmed -> disputed -> cancelled`

Implement practical transitions as:
1. `created -> paid` on successful payment.
2. `created -> cancelled` on explicit cancel before payment or payment expiry.
3. `paid -> shipped` for physical goods.
4. `paid -> confirmed` for digital/API goods or direct buyer confirm.
5. `shipped -> confirmed` on buyer confirm.
6. `paid|shipped -> auto_confirmed` when `confirm_deadline` passes.
7. `paid|shipped -> disputed` before auto-confirm/final release.
8. `disputed -> confirmed|cancelled` only by admin resolution policy.

Notes:
1. Do not allow `auto_confirmed -> disputed` unless business rules explicitly reopen.
2. Map settlement release trigger to `confirmed` and `auto_confirmed`.
3. Payment retries on `created` orders must support fallback from stale/failed PI to human checkout URL.

## Buyer Payment Mode (`agents.buyer_payment_mode`)

Allowed transitions:
1. `bootstrap_required -> mit_enabled` after first successful checkout/payment webhook.
2. `mit_enabled -> human_every_time` on payment failure/checkout expiry or payment-method binding risk.
3. `human_every_time -> mit_enabled` after next successful human checkout and payment-method binding.

Policy:
1. `bootstrap_required`: `/orders/:id/pay` must return `human_assistance.checkout_url`.
2. `mit_enabled`: attempt MIT (`customer + payment_method + off_session + confirm`) first.
3. `mit_enabled` with no saved method: fallback to `human_assistance.checkout_url`.
4. `human_every_time`: always require human checkout.

Operational note:
1. When `requires_payment_method` appears on an existing PI, API should generate a fresh checkout URL instead of returning non-actionable state only.

## Confirmation Deadline Policy

Defaults:
1. Physical: `paid` timestamp + 7 days.
2. Digital/API: `paid` timestamp + 1 day.

Risk override:
1. Extend deadline for large-value orders.
2. Extend deadline for anomaly flags.

## Cron Jobs

Run at least every 5-15 minutes:
1. Find orders `status in (paid, shipped)` and `confirm_deadline <= now`.
2. Transition to `auto_confirmed`.
3. Trigger settlement release workflow.
4. Emit audit event.

Run at least every 15 minutes for claims:
1. Find pending claims.
2. Query X recent search for verification codes.
3. Mark matched claims as `verified`.
4. Mark TTL-expired claims as `expired`.

## Dispute Workflow (MVP Manual)

1. Create dispute with `status = open`.
2. Move to `reviewing` when admin picks up.
3. Resolve as:
   - `resolved_buyer` with refund/partial refund logic.
   - `resolved_seller` with release logic.
   - `rejected` if invalid claim.

## Settlement Accounting Notes

Persist both flow and profitability fields:
1. `platform_fee_amount_cents` (application fee)
2. `stripe_fee_amount_cents` (Stripe processing fee)
3. `seller_transfer_amount_cents` (gross - platform fee for destination charge view)
4. `platform_net_profit_cents = platform_fee_amount_cents - stripe_fee_amount_cents`

Concurrency guard:
1. Settlement capture must treat order-status update `0 rows affected` as conflict (`ORDER_STATUS_CONFLICT`), not success.
