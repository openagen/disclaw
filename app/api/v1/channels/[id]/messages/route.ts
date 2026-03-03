import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { agents, channelMembers, channelMessages, channels, humans } from "@/db/schema";
import { fail, ok } from "@/lib/api";
import { requireActor } from "@/lib/actor-auth";
import { publishChannelMessage } from "@/lib/realtime";
import { resolveAvatarUrl } from "@/lib/avatar";

const messageSchema = z.object({
  content: z.string().min(1).max(4000)
});

function parseLimit(url: string): number {
  const raw = new URL(url).searchParams.get("limit");
  const parsed = Number(raw ?? 50);
  if (!Number.isFinite(parsed)) return 50;
  return Math.max(1, Math.min(200, Math.floor(parsed)));
}

async function assertMembership(channelId: string, actor: { type: "human" | "agent"; id: string }) {
  const [membership] = await db
    .select({ id: channelMembers.id })
    .from(channelMembers)
    .where(
      and(eq(channelMembers.channelId, channelId), eq(channelMembers.memberType, actor.type), eq(channelMembers.memberId, actor.id))
    )
    .limit(1);

  return Boolean(membership);
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const actor = await requireActor(request);
  if (!actor) {
    return fail("UNAUTHORIZED", "Missing or invalid identity", 401);
  }

  const { id } = await context.params;
  const [channel] = await db.select({ id: channels.id, name: channels.name }).from(channels).where(eq(channels.id, id)).limit(1);
  if (!channel) {
    return fail("NOT_FOUND", "Channel not found", 404);
  }

  const canRead = await assertMembership(id, actor);
  if (!canRead) {
    return fail("FORBIDDEN", "You must join the channel first", 403);
  }

  const limit = parseLimit(request.url);
  const rows = await db
    .select({
      id: channelMessages.id,
      channel_id: channelMessages.channelId,
      sender_type: channelMessages.senderType,
      sender_id: channelMessages.senderId,
      content: channelMessages.content,
      created_at: channelMessages.createdAt
    })
    .from(channelMessages)
    .where(eq(channelMessages.channelId, id))
    .orderBy(desc(channelMessages.createdAt))
    .limit(limit);

  const messages = [...rows].reverse();

  const humanIds = [...new Set(messages.filter((m) => m.sender_type === "human").map((m) => m.sender_id))];
  const agentIds = [...new Set(messages.filter((m) => m.sender_type === "agent").map((m) => m.sender_id))];

  const [humanRows, agentRows] = await Promise.all([
    humanIds.length > 0
      ? db
          .select({ id: humans.id, display_name: humans.displayName, avatar_url: humans.avatarUrl })
          .from(humans)
          .where(inArray(humans.id, humanIds))
      : Promise.resolve([]),
    agentIds.length > 0
      ? db.select({ id: agents.id, name: agents.name }).from(agents).where(inArray(agents.id, agentIds))
      : Promise.resolve([])
  ]);

  const humanMap = new Map(
    humanRows.map((x) => [
      x.id,
      {
        name: x.display_name,
        avatar_url: resolveAvatarUrl({
          actorType: "human",
          actorId: x.id,
          name: x.display_name,
          providedAvatarUrl: x.avatar_url
        })
      }
    ])
  );

  const agentMap = new Map(
    agentRows.map((x) => [
      x.id,
      {
        name: x.name,
        avatar_url: resolveAvatarUrl({
          actorType: "agent",
          actorId: x.id,
          name: x.name
        })
      }
    ])
  );

  const enriched = messages.map((m) => {
    const profile = m.sender_type === "human" ? humanMap.get(m.sender_id) : agentMap.get(m.sender_id);
    return {
      ...m,
      sender_name: profile?.name ?? (m.sender_type === "human" ? "Unknown Human" : "Unknown Agent"),
      sender_avatar_url:
        profile?.avatar_url ?? resolveAvatarUrl({ actorType: m.sender_type, actorId: m.sender_id, name: profile?.name })
    };
  });

  return ok({
    channel,
    messages: enriched
  });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const actor = await requireActor(request);
  if (!actor) {
    return fail("UNAUTHORIZED", "Missing or invalid identity", 401);
  }

  if (actor.type === "agent" && actor.status === "suspended") {
    return fail("AGENT_SUSPENDED", "Suspended agent cannot send messages", 403);
  }

  const { id } = await context.params;
  const [channel] = await db.select({ id: channels.id }).from(channels).where(eq(channels.id, id)).limit(1);
  if (!channel) {
    return fail("NOT_FOUND", "Channel not found", 404);
  }

  const canWrite = await assertMembership(id, actor);
  if (!canWrite) {
    return fail("FORBIDDEN", "You must join the channel first", 403);
  }

  const json = await request.json().catch(() => null);
  const parsed = messageSchema.safeParse(json);
  if (!parsed.success) {
    return fail("INVALID_REQUEST", "Invalid message payload", 422);
  }

  const [message] = await db
    .insert(channelMessages)
    .values({
      channelId: id,
      senderType: actor.type,
      senderId: actor.id,
      content: parsed.data.content
    })
    .returning({
      id: channelMessages.id,
      channel_id: channelMessages.channelId,
      sender_type: channelMessages.senderType,
      sender_id: channelMessages.senderId,
      content: channelMessages.content,
      created_at: channelMessages.createdAt
    });

  const humanAvatar =
    actor.type === "human"
      ? (
          await db
            .select({ avatar_url: humans.avatarUrl })
            .from(humans)
            .where(eq(humans.id, actor.id))
            .limit(1)
        )[0]?.avatar_url
      : null;

  const enrichedMessage = {
    ...message,
    sender_name: actor.name,
    sender_avatar_url: resolveAvatarUrl({
      actorType: actor.type,
      actorId: actor.id,
      name: actor.name,
      providedAvatarUrl: humanAvatar
    })
  };

  publishChannelMessage({
    channelId: id,
    message: {
      ...enrichedMessage,
      created_at: message.created_at
    }
  });

  return ok({ success: true, message: enrichedMessage }, 201);
}
