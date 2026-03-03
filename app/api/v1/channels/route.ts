import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { agents, channelMembers, channels, humans, serverMembers, servers } from "@/db/schema";
import { fail, ok } from "@/lib/api";
import { requireActor } from "@/lib/actor-auth";

const memberSchema = z.object({
  type: z.enum(["human", "agent"]),
  id: z.string().uuid()
});

const createChannelSchema = z.object({
  server_id: z.string().uuid(),
  name: z.string().min(1).max(120),
  members: z.array(memberSchema).max(100).optional().default([])
});

export async function GET(request: Request) {
  const actor = await requireActor(request);
  if (!actor) {
    return fail("UNAUTHORIZED", "Missing or invalid identity", 401);
  }

  const serverId = new URL(request.url).searchParams.get("server_id");
  if (!serverId) {
    return fail("INVALID_REQUEST", "server_id is required", 422);
  }

  const [server] = await db.select({ id: servers.id }).from(servers).where(eq(servers.id, serverId)).limit(1);
  if (!server) {
    return fail("NOT_FOUND", "Server not found", 404);
  }

  const [serverMembership] = await db
    .select({
      id: serverMembers.id
    })
    .from(serverMembers)
    .where(
      and(
        eq(serverMembers.serverId, serverId),
        eq(serverMembers.memberType, actor.type),
        eq(serverMembers.memberId, actor.id)
      )
    ).limit(1);

  if (!serverMembership) {
    return fail("FORBIDDEN", "You must join the server first", 403);
  }

  const allChannels = await db
    .select({
      id: channels.id,
      server_id: channels.serverId,
      name: channels.name,
      created_by_type: channels.createdByType,
      created_by_id: channels.createdById,
      created_at: channels.createdAt
    })
    .from(channels)
    .where(eq(channels.serverId, serverId))
    .orderBy(desc(channels.createdAt));

  const memberRows = await db
    .select({
      channel_id: channelMembers.channelId,
      joined_at: channelMembers.joinedAt
    })
    .from(channelMembers)
    .where(
      and(
        eq(channelMembers.memberType, actor.type),
        eq(channelMembers.memberId, actor.id)
      )
    );
  const memberMap = new Map(memberRows.map((m) => [m.channel_id, m.joined_at]));

  const rows = allChannels.map((ch) => ({
    ...ch,
    joined_at: memberMap.get(ch.id) ?? null,
    is_member: memberMap.has(ch.id)
  }));

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

  const [server] = await db.select({ id: servers.id }).from(servers).where(eq(servers.id, parsed.data.server_id)).limit(1);
  if (!server) {
    return fail("SERVER_NOT_FOUND", "Server not found", 404);
  }

  const [actorServerMembership] = await db
    .select({ id: serverMembers.id })
    .from(serverMembers)
    .where(
      and(
        eq(serverMembers.serverId, parsed.data.server_id),
        eq(serverMembers.memberType, actor.type),
        eq(serverMembers.memberId, actor.id)
      )
    )
    .limit(1);

  if (!actorServerMembership) {
    return fail("FORBIDDEN", "You must join the server first", 403);
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
  const allMemberKeys = new Set(dedupedMembers.map((m) => `${m.type}:${m.id}`));

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

  const serverMemberRows = await db
    .select({ member_type: serverMembers.memberType, member_id: serverMembers.memberId })
    .from(serverMembers)
    .where(eq(serverMembers.serverId, parsed.data.server_id));
  const serverMemberKeys = new Set(serverMemberRows.map((m) => `${m.member_type}:${m.member_id}`));
  const invalidMembers = [...allMemberKeys].filter((key) => !serverMemberKeys.has(key));
  if (invalidMembers.length > 0) {
    return fail("INVALID_MEMBERS", "All channel members must already be in the server", 422);
  }

  const result = await db.transaction(async (tx) => {
    const [channel] = await tx
      .insert(channels)
      .values({
        serverId: parsed.data.server_id,
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
