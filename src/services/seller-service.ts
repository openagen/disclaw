import { eq } from "drizzle-orm";
import Stripe from "stripe";
import { db } from "@/db/client";
import { agents, sellers } from "@/db/schema";
import { env } from "@/lib/env";

const stripe = new Stripe(env.STRIPE_SECRET_KEY);

export async function applySeller(agentId: string) {
  const [existing] = await db.select().from(sellers).where(eq(sellers.agentId, agentId)).limit(1);

  const accountId =
    existing?.stripeAccountId ??
    (
      await stripe.accounts.create({
        type: "express",
        metadata: {
          claw_agent_id: agentId
        }
      })
    ).id;

  if (!existing) {
    await db.insert(sellers).values({
      agentId,
      stripeAccountId: accountId,
      reviewStatus: "pending"
    });
  }

  await db.update(agents).set({ status: "pending_kyc" }).where(eq(agents.id, agentId));

  const base = env.SHARECLAW_BASE_URL ?? env.DISCLAW_BASE_URL ?? env.CLAWSHOP_BASE_URL ?? "http://localhost:3000";
  const accountLink = await stripe.accountLinks.create({
    account: accountId,
    refresh_url: `${base}/seller/onboarding/refresh`,
    return_url: `${base}/seller/onboarding/return`,
    type: "account_onboarding"
  });

  return { stripeOnboardingUrl: accountLink.url };
}

export async function markKycVerifiedByStripeAccount(accountId: string) {
  const [seller] = await db.select().from(sellers).where(eq(sellers.stripeAccountId, accountId)).limit(1);
  if (!seller) return;

  const [agent] = await db.select().from(agents).where(eq(agents.id, seller.agentId)).limit(1);
  if (!agent) return;
  if (agent.status === "seller_approved" || agent.status === "suspended") return;

  await db.update(agents).set({ status: "kyc_verified" }).where(eq(agents.id, seller.agentId));
}

export async function checkAndUpdateKycStatus() {
  const pendingAgents = await db.select().from(agents).where(eq(agents.status, "pending_kyc"));

  let checked = 0;
  let updated = 0;

  for (const agent of pendingAgents) {
    checked += 1;

    const [seller] = await db.select().from(sellers).where(eq(sellers.agentId, agent.id)).limit(1);
    if (!seller || !seller.stripeAccountId) {
      continue;
    }

    try {
      const account = await stripe.accounts.retrieve(seller.stripeAccountId);

      // Check if KYC is verified (both charges and payouts enabled)
      if (account.charges_enabled && account.payouts_enabled) {
        await db.update(agents).set({ status: "kyc_verified" }).where(eq(agents.id, agent.id));
        updated += 1;
      }
    } catch (error) {
      // Log error but continue processing other agents
      console.error(`Failed to check Stripe account ${seller.stripeAccountId}:`, error);
    }
  }

  return { checked, updated };
}
