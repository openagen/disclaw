import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { agents, channelMembers, channels, humans } from "@/db/schema";
import { fail, ok } from "@/lib/api";
import { requireActor } from "@/lib/actor-auth";

const removeMemberSchema = z.object({
  member_type: z.enum(["human", "agent"]),
  member_id: z.string().uuid()
});

async function isMember(channelId: string, actorType: "human" | "agent", actorId: string) {
  const [row] = await db
    .select({ id: channelMembers.id })
    .from(channelMembers)
    .where(and(eq(channelMembers.channelId, channelId), eq(channelMembers.memberType, actorType), eq(channelMembers.memberId, actorId)))
    .limit(1);

  return Boolean(row);
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const actor = await requireActor(request);
  if (!actor) {
    return fail("UNAUTHORIZED", "Missing or invalid identity", 401);
  }

  const { id } = await context.params;
  const [channel] = await db
    .select({ id: channels.id, name: channels.name, created_by_type: channels.createdByType, created_by_id: channels.createdById })
    .from(channels)
    .where(eq(channels.id, id))
    .limit(1);

  if (!channel) {
    return fail("NOT_FOUND", "Channel not found", 404);
  }

  const canRead = await isMember(id, actor.type, actor.id);
  if (!canRead) {
    return fail("FORBIDDEN", "You must join the channel first", 403);
  }

  const rows = await db
    .select({
      id: channelMembers.id,
      member_type: channelMembers.memberType,
      member_id: channelMembers.memberId,
      joined_at: channelMembers.joinedAt
    })
    .from(channelMembers)
    .where(eq(channelMembers.channelId, id));

  const humanIds = [...new Set(rows.filter((x) => x.member_type === "human").map((x) => x.member_id))];
  const agentIds = [...new Set(rows.filter((x) => x.member_type === "agent").map((x) => x.member_id))];

  const [humanRows, agentRows] = await Promise.all([
    humanIds.length > 0
      ? db
          .select({ id: humans.id, name: humans.displayName, email: humans.email })
          .from(humans)
          .where(inArray(humans.id, humanIds))
      : Promise.resolve([]),
    agentIds.length > 0 ? db.select({ id: agents.id, name: agents.name }).from(agents).where(inArray(agents.id, agentIds)) : Promise.resolve([])
  ]);

  const humanMap = new Map(humanRows.map((x) => [x.id, { name: x.name, subtitle: x.email }]));
  const agentMap = new Map(agentRows.map((x) => [x.id, { name: x.name, subtitle: "agent" }]));

  return ok({
    channel,
    members: rows.map((row) => {
      const profile = row.member_type === "human" ? humanMap.get(row.member_id) : agentMap.get(row.member_id);
      return {
        ...row,
        member_name: profile?.name ?? `Unknown ${row.member_type}`,
        member_subtitle: profile?.subtitle ?? null,
        removable_by_actor:
          row.member_type === actor.type && row.member_id === actor.id
            ? true
            : channel.created_by_type === actor.type && channel.created_by_id === actor.id
      };
    })
  });
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const actor = await requireActor(request);
  if (!actor) {
    return fail("UNAUTHORIZED", "Missing or invalid identity", 401);
  }

  const { id } = await context.params;
  const [channel] = await db
    .select({ id: channels.id, created_by_type: channels.createdByType, created_by_id: channels.createdById })
    .from(channels)
    .where(eq(channels.id, id))
    .limit(1);

  if (!channel) {
    return fail("NOT_FOUND", "Channel not found", 404);
  }

  const canRead = await isMember(id, actor.type, actor.id);
  if (!canRead) {
    return fail("FORBIDDEN", "You must join the channel first", 403);
  }

  const json = await request.json().catch(() => null);
  const parsed = removeMemberSchema.safeParse(json);
  if (!parsed.success) {
    return fail("INVALID_REQUEST", "Invalid member remove payload", 422);
  }

  const target = parsed.data;
  const actorIsOwner = channel.created_by_type === actor.type && channel.created_by_id === actor.id;
  const actorIsSelf = target.member_type === actor.type && target.member_id === actor.id;

  if (!actorIsOwner && !actorIsSelf) {
    return fail("FORBIDDEN", "Only channel owner can remove other members", 403);
  }

  if (target.member_type === channel.created_by_type && target.member_id === channel.created_by_id) {
    return fail("FORBIDDEN", "Channel owner cannot be removed", 403);
  }

  const removed = await db
    .delete(channelMembers)
    .where(and(eq(channelMembers.channelId, id), eq(channelMembers.memberType, target.member_type), eq(channelMembers.memberId, target.member_id)))
    .returning({ id: channelMembers.id });

  if (removed.length === 0) {
    return fail("NOT_FOUND", "Member not found", 404);
  }

  return ok({ success: true, removed: true });
}
