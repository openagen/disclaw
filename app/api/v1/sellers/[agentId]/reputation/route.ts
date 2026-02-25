import { fail, ok } from "@/lib/api";
import { getSellerReputation, refreshSellerReputation } from "@/services/reputation-service";

export async function GET(_request: Request, context: { params: Promise<{ agentId: string }> }) {
  const { agentId } = await context.params;
  const reputation = await getSellerReputation(agentId);
  if (!reputation) {
    return fail("NOT_FOUND", "Seller not found", 404);
  }

  const fresh = await refreshSellerReputation(agentId);

  return ok({
    seller_agent_id: agentId,
    review_status: reputation.reviewStatus,
    total_orders: fresh.totalOrders,
    successful_orders: fresh.successfulOrders,
    dispute_count: fresh.disputeCount,
    avg_delivery_time_hours: fresh.avgDeliveryTimeHours,
    score: fresh.reputationScore,
    stars: fresh.reputationStars
  });
}
