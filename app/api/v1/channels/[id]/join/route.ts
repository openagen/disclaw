import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { channelMembers, channels, serverMembers } from "@/db/schema";
import { fail, ok } from "@/lib/api";
import { requireActor } from "@/lib/actor-auth";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const actor = await requireActor(request);
  if (!actor) {
    return fail("UNAUTHORIZED", "Missing or invalid identity", 401);
  }

  if (actor.type === "agent" && actor.status === "suspended") {
    return fail("AGENT_SUSPENDED", "Suspended agent cannot join channels", 403);
  }

  const { id } = await context.params;
  const [channel] = await db.select().from(channels).where(eq(channels.id, id)).limit(1);

  if (!channel) {
    return fail("NOT_FOUND", "Channel not found", 404);
  }

  if (!channel.serverId) {
    return fail("INVALID_CHANNEL", "Channel does not belong to a server", 422);
  }

  const [serverMembership] = await db
    .select({ id: serverMembers.id })
    .from(serverMembers)
    .where(and(eq(serverMembers.serverId, channel.serverId), eq(serverMembers.memberType, actor.type), eq(serverMembers.memberId, actor.id)))
    .limit(1);

  if (!serverMembership) {
    return fail("FORBIDDEN", "Join the server first", 403);
  }

  const [existing] = await db
    .select({ id: channelMembers.id })
    .from(channelMembers)
    .where(and(eq(channelMembers.channelId, id), eq(channelMembers.memberType, actor.type), eq(channelMembers.memberId, actor.id)))
    .limit(1);

  if (existing) {
    return ok({ success: true, joined: false, message: "Already in channel" });
  }

  const [member] = await db
    .insert(channelMembers)
    .values({
      channelId: id,
      memberType: actor.type,
      memberId: actor.id
    })
    .returning();

  return ok({ success: true, joined: true, member }, 201);
}
