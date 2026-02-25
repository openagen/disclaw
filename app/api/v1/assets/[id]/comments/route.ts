import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { agents, assetComments, assets, orders } from "@/db/schema";
import { fail, ok } from "@/lib/api";
import { requireAgent } from "@/lib/auth";

const createCommentSchema = z.object({
  rating: z.coerce.number().int().min(1).max(5),
  content: z.string().min(2).max(2000)
});

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;

  const [asset] = await db.select().from(assets).where(eq(assets.id, id)).limit(1);
  if (!asset) {
    return fail("NOT_FOUND", "Asset not found", 404);
  }

  const rows = await db
    .select({
      id: assetComments.id,
      asset_id: assetComments.assetId,
      reviewer_agent_id: assetComments.reviewerAgentId,
      reviewer_name: agents.name,
      rating: assetComments.rating,
      content: assetComments.content,
      created_at: assetComments.createdAt
    })
    .from(assetComments)
    .innerJoin(agents, eq(agents.id, assetComments.reviewerAgentId))
    .where(eq(assetComments.assetId, id))
    .orderBy(desc(assetComments.createdAt));

  const summary = rows.reduce(
    (acc, row) => {
      acc.total += 1;
      acc.sum += row.rating;
      return acc;
    },
    { total: 0, sum: 0 }
  );

  return ok({
    asset_id: id,
    stats: {
      total_comments: summary.total,
      average_rating: summary.total > 0 ? Number((summary.sum / summary.total).toFixed(2)) : null
    },
    comments: rows
  });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const agent = await requireAgent(request);
  if (!agent) {
    return fail("UNAUTHORIZED", "Missing or invalid signature", 401);
  }

  if (agent.status === "suspended") {
    return fail("AGENT_SUSPENDED", "Suspended agent cannot comment", 403);
  }

  const { id } = await context.params;
  const [asset] = await db.select().from(assets).where(eq(assets.id, id)).limit(1);
  if (!asset || asset.status !== "approved") {
    return fail("NOT_FOUND", "Approved asset not found", 404);
  }

  const json = await request.json().catch(() => null);
  const parsed = createCommentSchema.safeParse(json);
  if (!parsed.success) {
    return fail("INVALID_REQUEST", "Invalid comment payload", 422);
  }

  const [purchase] = await db
    .select({ id: orders.id })
    .from(orders)
    .where(
      and(
        eq(orders.assetId, id),
        eq(orders.buyerAgentId, agent.id),
        inArray(orders.status, ["paid", "shipped", "confirmed", "auto_confirmed"])
      )
    )
    .limit(1);

  if (!purchase) {
    return fail("FORBIDDEN", "Only buyers with paid orders can comment", 403);
  }

  const [created] = await db
    .select()
    .from(assetComments)
    .where(and(eq(assetComments.assetId, id), eq(assetComments.reviewerAgentId, agent.id)))
    .limit(1);

  if (created) {
    const [updated] = await db
      .update(assetComments)
      .set({
        rating: parsed.data.rating,
        content: parsed.data.content
      })
      .where(eq(assetComments.id, created.id))
      .returning();

    return ok({ success: true, mode: "updated", comment: updated });
  }

  const [inserted] = await db
    .insert(assetComments)
    .values({
      assetId: id,
      reviewerAgentId: agent.id,
      rating: parsed.data.rating,
      content: parsed.data.content
    })
    .returning();

  return ok({ success: true, mode: "created", comment: inserted }, 201);
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const agent = await requireAgent(request);
  if (!agent) {
    return fail("UNAUTHORIZED", "Missing or invalid signature", 401);
  }

  const { id } = await context.params;
  const deleted = await db
    .delete(assetComments)
    .where(and(eq(assetComments.assetId, id), eq(assetComments.reviewerAgentId, agent.id)))
    .returning({ id: assetComments.id });

  if (deleted.length === 0) {
    return fail("NOT_FOUND", "Comment not found", 404);
  }

  return ok({ success: true, deleted_comment_id: deleted[0].id });
}
