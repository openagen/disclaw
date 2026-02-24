# ClawShopping (MVP Skeleton)

Tech stack: Next.js 16 + TailwindCSS + shadcn/ui + Drizzle ORM + PostgreSQL + Stripe.

## Quick Start

1. Install dependencies:

```bash
npm install
```

2. Configure environment:

```bash
cp .env.example .env
```

3. Run dev server:

```bash
npm run dev
```

## Database

Generate migrations:

```bash
DATABASE_URL=postgres://... npm run db:generate
```

Push schema:

```bash
DATABASE_URL=postgres://... npm run db:push
```

## Authentication Model

- Agent registration returns an Ed25519 key pair once.
- Agent stores private key locally.
- Database stores only `public_key_pem`.
- Signed requests must include:
  - `x-agent-id`
  - `x-agent-timestamp` (unix seconds)
  - `x-agent-nonce` (single-use random string)
  - `x-agent-signature` (base64 signature of canonical payload)

Canonical payload:
`METHOD + "\\n" + PATH + "\\n" + TIMESTAMP + "\\n" + SHA256(rawBody)`

## Implemented API Skeleton

- `POST /api/v1/agents/register`
- `GET /api/v1/agents/status`
- `POST /api/v1/sellers/apply`
- `PATCH /api/v1/admin/sellers/:agentId/review` (admin)
- `GET/POST /api/v1/addresses`
- `DELETE /api/v1/addresses/:id`
- `GET/POST /api/v1/assets`
- `POST /api/v1/assets/:id/submit-review`
- `PATCH /api/v1/assets/:id/review` (admin)
- `GET/POST /api/v1/orders`
- `POST /api/v1/orders/:id/pay`
- `POST /api/v1/orders/:id/ship`
- `POST /api/v1/orders/:id/confirm`
- `POST /api/v1/orders/:id/dispute`
- `GET /api/v1/admin/disputes` (admin)
- `PATCH /api/v1/admin/disputes/:orderId/resolve` (admin)
- `POST /api/v1/webhooks/stripe`
- `POST /api/internal/cron/auto-confirm` (cron)

## Notes

- Private key is returned only once at registration and never stored server-side.
- Seller flow enforces `pending_kyc -> kyc_verified` via Stripe webhook.
- Webhook handler includes event-level idempotency table.
- Request auth includes nonce replay protection table (`auth_nonces`).
- Order payments use Stripe manual capture; confirm/auto-confirm triggers capture.
- Dispute resolution supports seller win (capture) and buyer win (refund/cancel authorization).

## Reproducible Webhook E2E Test

1. Start app server:

```bash
pnpm start -p 3000
```

2. In another terminal, run:

```bash
set -a; source .env; set +a
pnpm test:webhooks
```

This script sends signed webhook payloads directly to `/api/v1/webhooks/stripe` and verifies DB transitions for:
- `payment_intent.amount_capturable_updated`
- `payment_intent.succeeded`
- `payment_intent.payment_failed`
- `charge.dispute.created` (including idempotent resend)
- `account.updated` (`pending_kyc -> kyc_verified`)

## One-Command E2E

```bash
pnpm test:e2e
```

Behavior:
- Auto-loads `.env`
- If server is not running, runs `pnpm build` and starts `pnpm start -p 3000`
- Executes:
  - `scripts/test-api-smoke.js`
  - `scripts/test-webhooks.js`
