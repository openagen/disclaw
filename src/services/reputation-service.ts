import { eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { orders, sellers } from "@/db/schema";

type ReputationMetrics = {
  totalOrders: number;
  successfulOrders: number;
  disputeCount: number;
  avgDeliveryTimeHours: number | null;
  reputationScore: number;
  reputationStars: number;
};

function calcReputation(metrics: Omit<ReputationMetrics, "reputationScore" | "reputationStars">): ReputationMetrics {
  const total = metrics.totalOrders;
  const successRate = total > 0 ? metrics.successfulOrders / total : 0;
  const disputeRatioPenalty = total > 0 ? metrics.disputeCount / total : 0;

  // Simple model: score = success_rate - dispute_ratio_penalty
  const raw = successRate - disputeRatioPenalty;
  const score = Math.max(0, Math.min(1, raw)) * 100;
  const stars = Math.max(0, Math.min(5, score / 20));

  return {
    ...metrics,
    reputationScore: Number(score.toFixed(2)),
    reputationStars: Number(stars.toFixed(2))
  };
}

async function computeMetrics(sellerAgentId: string): Promise<ReputationMetrics> {
  const totalQ = await db
    .select({
      count: sql<number>`count(*)::int`
    })
    .from(orders)
    .where(
      sql`${orders.sellerAgentId} = ${sellerAgentId} and ${orders.status} in ('paid','shipped','confirmed','auto_confirmed','disputed','cancelled')`
    );

  const successQ = await db
    .select({
      count: sql<number>`count(*)::int`
    })
    .from(orders)
    .where(sql`${orders.sellerAgentId} = ${sellerAgentId} and ${orders.status} in ('confirmed','auto_confirmed')`);

  const disputeQ = await db
    .select({
      count: sql<number>`count(*)::int`
    })
    .from(orders)
    .where(sql`${orders.sellerAgentId} = ${sellerAgentId} and ${orders.status} = 'disputed'`);

  const avgDeliveryQ = await db.execute(sql`
    select avg(extract(epoch from (s.created_at - o.created_at)) / 3600.0)::numeric(8,2) as avg_hours
    from orders o
    join settlements s on s.order_id = o.id
    where o.seller_agent_id = ${sellerAgentId}
      and s.action = 'capture'
      and s.status = 'succeeded'
  `);

  const totalOrders = Number(totalQ[0]?.count ?? 0);
  const successfulOrders = Number(successQ[0]?.count ?? 0);
  const disputeCount = Number(disputeQ[0]?.count ?? 0);
  const avgRaw = (avgDeliveryQ.rows?.[0] as { avg_hours?: string | number | null } | undefined)?.avg_hours ?? null;
  const avgDeliveryTimeHours = avgRaw === null ? null : Number(avgRaw);

  return calcReputation({
    totalOrders,
    successfulOrders,
    disputeCount,
    avgDeliveryTimeHours
  });
}

export async function refreshSellerReputation(sellerAgentId: string) {
  const metrics = await computeMetrics(sellerAgentId);

  await db
    .update(sellers)
    .set({
      totalOrders: metrics.totalOrders,
      successfulOrders: metrics.successfulOrders,
      disputeCount: metrics.disputeCount,
      avgDeliveryTimeHours: metrics.avgDeliveryTimeHours === null ? null : metrics.avgDeliveryTimeHours.toFixed(2),
      reputationScore: metrics.reputationScore.toFixed(2),
      reputationStars: metrics.reputationStars.toFixed(2)
    })
    .where(eq(sellers.agentId, sellerAgentId));

  return metrics;
}

export async function refreshSellerReputationByOrderId(orderId: string) {
  const [order] = await db.select({ sellerAgentId: orders.sellerAgentId }).from(orders).where(eq(orders.id, orderId)).limit(1);
  if (!order) return null;
  return refreshSellerReputation(order.sellerAgentId);
}

export async function getSellerReputation(agentId: string) {
  const [seller] = await db
    .select({
      agentId: sellers.agentId,
      totalOrders: sellers.totalOrders,
      successfulOrders: sellers.successfulOrders,
      disputeCount: sellers.disputeCount,
      avgDeliveryTimeHours: sellers.avgDeliveryTimeHours,
      reputationScore: sellers.reputationScore,
      reputationStars: sellers.reputationStars,
      reviewStatus: sellers.reviewStatus
    })
    .from(sellers)
    .where(eq(sellers.agentId, agentId))
    .limit(1);

  if (!seller) return null;

  return {
    agentId: seller.agentId,
    reviewStatus: seller.reviewStatus,
    totalOrders: Number(seller.totalOrders ?? 0),
    successfulOrders: Number(seller.successfulOrders ?? 0),
    disputeCount: Number(seller.disputeCount ?? 0),
    avgDeliveryTimeHours: seller.avgDeliveryTimeHours === null ? null : Number(seller.avgDeliveryTimeHours),
    reputationScore: Number(seller.reputationScore ?? 0),
    reputationStars: Number(seller.reputationStars ?? 0)
  };
}
