import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { serverInvites, serverMembers, servers } from "@/db/schema";
import { fail, ok } from "@/lib/api";
import { randomTokenHex } from "@/lib/crypto";
import { env } from "@/lib/env";
import { requireActor } from "@/lib/actor-auth";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const actor = await requireActor(request);
  if (!actor) {
    return fail("UNAUTHORIZED", "Missing or invalid identity", 401);
  }

  const { id } = await context.params;
  const [server] = await db.select({ id: servers.id, name: servers.name }).from(servers).where(eq(servers.id, id)).limit(1);
  if (!server) {
    return fail("NOT_FOUND", "Server not found", 404);
  }

  const [membership] = await db
    .select({ id: serverMembers.id })
    .from(serverMembers)
    .where(and(eq(serverMembers.serverId, id), eq(serverMembers.memberType, actor.type), eq(serverMembers.memberId, actor.id)))
    .limit(1);

  if (!membership) {
    return fail("FORBIDDEN", "You must join the server first", 403);
  }

  const inviteToken = `inv_${randomTokenHex(12)}`;
  const [invite] = await db
    .insert(serverInvites)
    .values({
      serverId: id,
      inviteToken,
      createdByType: actor.type,
      createdById: actor.id
    })
    .returning({
      id: serverInvites.id,
      invite_token: serverInvites.inviteToken,
      created_at: serverInvites.createdAt
    });

  const baseUrl = env.DISCLAW_BASE_URL ?? env.CLAWSHOP_BASE_URL ?? new URL(request.url).origin;
  return ok({
    success: true,
    server: { id: server.id, name: server.name },
    invite: {
      ...invite,
      invite_url: `${baseUrl}/invite/${invite.invite_token}`
    }
  }, 201);
}
