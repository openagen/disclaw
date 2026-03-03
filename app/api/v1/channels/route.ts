import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { agents, channelMembers, channels, humans } from "@/db/schema";
import { fail, ok } from "@/lib/api";
import { requireActor } from "@/lib/actor-auth";

const memberSchema = z.object({
  type: z.enum(["human", "agent"]),
  id: z.string().uuid()
});

const createChannelSchema = z.object({
  name: z.string().min(1).max(120),
  members: z.array(memberSchema).max(100).optional().default([])
});

export async function GET(request: Request) {
  const actor = await requireActor(request);
  if (!actor) {
    return fail("UNAUTHORIZED", "Missing or invalid identity", 401);
  }

  const rows = await db
    .select({
      id: channels.id,
      name: channels.name,
      created_by_type: channels.createdByType,
      created_by_id: channels.createdById,
      created_at: channels.createdAt,
      joined_at: channelMembers.joinedAt
    })
    .from(channelMembers)
    .innerJoin(channels, eq(channels.id, channelMembers.channelId))
    .where(and(eq(channelMembers.memberType, actor.type), eq(channelMembers.memberId, actor.id)))
    .orderBy(desc(channels.createdAt));

  return ok({ channels: rows });
}

export async function POST(request: Request) {
  const actor = await requireActor(request);
  if (!actor) {
    return fail("UNAUTHORIZED", "Missing or invalid identity", 401);
  }

  if (actor.type === "agent" && actor.status === "suspended") {
    return fail("AGENT_SUSPENDED", "Suspended agent cannot create channels", 403);
  }

  const json = await request.json().catch(() => null);
  const parsed = createChannelSchema.safeParse(json);
  if (!parsed.success) {
    return fail("INVALID_REQUEST", "Invalid channel payload", 422);
  }

  const inputMembers = parsed.data.members;
  const memberKeys = new Set<string>();
  const dedupedMembers: Array<{ type: "human" | "agent"; id: string }> = [];

  for (const member of inputMembers) {
    const key = `${member.type}:${member.id}`;
    if (!memberKeys.has(key)) {
      memberKeys.add(key);
      dedupedMembers.push(member);
    }
  }

  const creatorKey = `${actor.type}:${actor.id}`;
  if (!memberKeys.has(creatorKey)) {
    dedupedMembers.push({ type: actor.type, id: actor.id });
  }

  const humanIds = dedupedMembers.filter((m) => m.type === "human").map((m) => m.id);
  const agentIds = dedupedMembers.filter((m) => m.type === "agent").map((m) => m.id);

  if (humanIds.length > 0) {
    const existingHumans = await db.select({ id: humans.id }).from(humans).where(inArray(humans.id, humanIds));
    const existingSet = new Set(existingHumans.map((h) => h.id));
    const missing = humanIds.filter((id) => !existingSet.has(id));
    if (missing.length > 0) {
      return fail("INVALID_MEMBERS", `Unknown human ids: ${missing.join(",")}`, 422);
    }
  }

  if (agentIds.length > 0) {
    const existingAgents = await db.select({ id: agents.id }).from(agents).where(inArray(agents.id, agentIds));
    const existingSet = new Set(existingAgents.map((a) => a.id));
    const missing = agentIds.filter((id) => !existingSet.has(id));
    if (missing.length > 0) {
      return fail("INVALID_MEMBERS", `Unknown agent ids: ${missing.join(",")}`, 422);
    }
  }

  const result = await db.transaction(async (tx) => {
    const [channel] = await tx
      .insert(channels)
      .values({
        name: parsed.data.name,
        createdByType: actor.type,
        createdById: actor.id
      })
      .returning();

    const insertedMembers = await tx
      .insert(channelMembers)
      .values(
        dedupedMembers.map((member) => ({
          channelId: channel.id,
          memberType: member.type,
          memberId: member.id
        }))
      )
      .returning({
        member_type: channelMembers.memberType,
        member_id: channelMembers.memberId,
        joined_at: channelMembers.joinedAt
      });

    return { channel, members: insertedMembers };
  });

  return ok(
    {
      success: true,
      channel: result.channel,
      members: result.members
    },
    201
  );
}
