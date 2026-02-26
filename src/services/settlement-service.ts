import { and, eq } from "drizzle-orm";
import Stripe from "stripe";
import { db } from "@/db/client";
import { orders, settlements } from "@/db/schema";
import { env } from "@/lib/env";

const stripe = new Stripe(env.STRIPE_SECRET_KEY);

async function getOrder(orderId: string) {
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
  return order ?? null;
}

type ReconcileData = {
  currency: string | null;
  grossAmountCents: number | null;
  stripeFeeAmountCents: number | null;
  platformFeeAmountCents: number | null;
  platformNetProfitCents: number | null;
  sellerTransferAmountCents: number | null;
  netAmountCents: number | null;
  stripeBalanceTransactionId: string | null;
};

function toUpperCurrency(value?: string | null) {
  if (!value) return null;
  return value.toUpperCase();
}

async function reconcileFromPaymentIntent(intentId: string): Promise<ReconcileData> {
  const intent = await stripe.paymentIntents.retrieve(intentId, {
    expand: ["latest_charge.balance_transaction"]
  });

  let charge: Stripe.Charge | null = null;
  if (intent.latest_charge && typeof intent.latest_charge !== "string") {
    charge = intent.latest_charge;
  } else if (intent.latest_charge && typeof intent.latest_charge === "string") {
    charge = await stripe.charges.retrieve(intent.latest_charge, {
      expand: ["balance_transaction"]
    });
  }

  let balanceTx: Stripe.BalanceTransaction | null = null;
  if (charge?.balance_transaction && typeof charge.balance_transaction !== "string") {
    balanceTx = charge.balance_transaction;
  }

  const gross = balanceTx?.amount ?? intent.amount ?? null;
  const stripeFee = balanceTx?.fee ?? null;
  const platformFee = intent.application_fee_amount ?? 0;
  const platformNetProfit = stripeFee !== null ? platformFee - stripeFee : null;
  const sellerTransfer = gross !== null ? gross - platformFee : null;
  const net = balanceTx?.net ?? (gross !== null && stripeFee !== null ? gross - stripeFee : null);

  return {
    currency: toUpperCurrency(balanceTx?.currency ?? intent.currency),
    grossAmountCents: gross,
    stripeFeeAmountCents: stripeFee,
    platformFeeAmountCents: platformFee,
    platformNetProfitCents: platformNetProfit,
    sellerTransferAmountCents: sellerTransfer,
    netAmountCents: net,
    stripeBalanceTransactionId: balanceTx?.id ?? null
  };
}

async function reconcileFromRefund(refundId: string): Promise<ReconcileData> {
  const refund = await stripe.refunds.retrieve(refundId, {
    expand: ["balance_transaction"]
  });

  const balanceTx =
    refund.balance_transaction && typeof refund.balance_transaction !== "string"
      ? refund.balance_transaction
      : null;

  const gross = refund.amount ?? null;
  const stripeFee = balanceTx?.fee ?? null;
  const net = balanceTx?.net ?? (gross !== null && stripeFee !== null ? gross - stripeFee : null);

  return {
    currency: toUpperCurrency(balanceTx?.currency ?? refund.currency),
    grossAmountCents: gross,
    stripeFeeAmountCents: stripeFee,
    platformFeeAmountCents: null,
    platformNetProfitCents: null,
    sellerTransferAmountCents: null,
    netAmountCents: net,
    stripeBalanceTransactionId: balanceTx?.id ?? null
  };
}

export async function settleOrderCapture(
  orderId: string,
  targetStatus: "confirmed" | "auto_confirmed" = "confirmed"
) {
  const order = await getOrder(orderId);
  if (!order?.stripePaymentIntentId) {
    return { ok: false, reason: "PAYMENT_INTENT_MISSING" };
  }

  const intent = await stripe.paymentIntents.retrieve(order.stripePaymentIntentId);

  if (intent.status === "requires_capture") {
    const captured = await stripe.paymentIntents.capture(intent.id, {}, { idempotencyKey: `order:${order.id}:capture` });
    const reconcile = await reconcileFromPaymentIntent(captured.id);
    await db.insert(settlements).values({
      orderId: order.id,
      action: "capture",
      status: "succeeded",
      stripeObjectId: captured.id,
      stripeBalanceTransactionId: reconcile.stripeBalanceTransactionId,
      currency: reconcile.currency,
      grossAmountCents: reconcile.grossAmountCents,
      stripeFeeAmountCents: reconcile.stripeFeeAmountCents,
      platformFeeAmountCents: reconcile.platformFeeAmountCents,
      platformNetProfitCents: reconcile.platformNetProfitCents,
      sellerTransferAmountCents: reconcile.sellerTransferAmountCents,
      netAmountCents: reconcile.netAmountCents
    });
  } else if (intent.status === "succeeded") {
    const reconcile = await reconcileFromPaymentIntent(intent.id);
    await db.insert(settlements).values({
      orderId: order.id,
      action: "capture",
      status: "succeeded",
      stripeObjectId: intent.id,
      stripeBalanceTransactionId: reconcile.stripeBalanceTransactionId,
      currency: reconcile.currency,
      grossAmountCents: reconcile.grossAmountCents,
      stripeFeeAmountCents: reconcile.stripeFeeAmountCents,
      platformFeeAmountCents: reconcile.platformFeeAmountCents,
      platformNetProfitCents: reconcile.platformNetProfitCents,
      sellerTransferAmountCents: reconcile.sellerTransferAmountCents,
      netAmountCents: reconcile.netAmountCents,
      reason: "already_captured"
    });
  } else {
    return { ok: false, reason: `UNEXPECTED_INTENT_STATUS:${intent.status}` };
  }

  const updated = await db
    .update(orders)
    .set({ status: targetStatus })
    .where(and(eq(orders.id, order.id), eq(orders.status, order.status)));
  if (updated.rowCount === 0) {
    // Webhook may transition the order to target status before this update.
    const latest = await getOrder(order.id);
    if (latest?.status === targetStatus) {
      return { ok: true, reason: "ALREADY_AT_TARGET_STATUS" };
    }
    return { ok: false, reason: "ORDER_STATUS_CONFLICT" };
  }

  return { ok: true };
}

export async function settleOrderRefund(orderId: string, reason: string) {
  const order = await getOrder(orderId);
  if (!order?.stripePaymentIntentId) {
    return { ok: false, reason: "PAYMENT_INTENT_MISSING" };
  }

  const intent = await stripe.paymentIntents.retrieve(order.stripePaymentIntentId);

  if (intent.status === "requires_capture") {
    const canceled = await stripe.paymentIntents.cancel(intent.id, {
      cancellation_reason: "requested_by_customer"
    });

    const gross = intent.amount ?? null;
    const platformFee = intent.application_fee_amount ?? 0;
    await db.insert(settlements).values({
      orderId: order.id,
      action: "cancel_authorization",
      status: "succeeded",
      stripeObjectId: canceled.id,
      currency: toUpperCurrency(intent.currency),
      grossAmountCents: gross,
      stripeFeeAmountCents: 0,
      platformFeeAmountCents: platformFee,
      platformNetProfitCents: platformFee,
      sellerTransferAmountCents: gross !== null ? gross - platformFee : null,
      netAmountCents: gross,
      reason
    });
  } else {
    const refund = await stripe.refunds.create(
      {
        payment_intent: intent.id,
        reason: "requested_by_customer",
        metadata: {
          order_id: order.id,
          dispute_reason: reason
        }
      },
      { idempotencyKey: `order:${order.id}:refund` }
    );

    const reconcile = await reconcileFromRefund(refund.id);
    await db.insert(settlements).values({
      orderId: order.id,
      action: "refund",
      status: "succeeded",
      stripeObjectId: refund.id,
      stripeBalanceTransactionId: reconcile.stripeBalanceTransactionId,
      currency: reconcile.currency,
      grossAmountCents: reconcile.grossAmountCents,
      stripeFeeAmountCents: reconcile.stripeFeeAmountCents,
      platformFeeAmountCents: reconcile.platformFeeAmountCents,
      platformNetProfitCents: reconcile.platformNetProfitCents,
      sellerTransferAmountCents: reconcile.sellerTransferAmountCents,
      netAmountCents: reconcile.netAmountCents,
      reason
    });
  }

  await db.update(orders).set({ status: "cancelled" }).where(eq(orders.id, order.id));

  return { ok: true };
}
