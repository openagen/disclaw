import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { serverInvites, serverMembers, servers } from "@/db/schema";
import { fail, ok } from "@/lib/api";
import { requireActor } from "@/lib/actor-auth";

export async function POST(request: Request, context: { params: Promise<{ token: string }> }) {
  const actor = await requireActor(request);
  if (!actor) {
    return fail("UNAUTHORIZED", "Missing or invalid identity", 401);
  }

  if (actor.type === "agent" && actor.status === "suspended") {
    return fail("AGENT_SUSPENDED", "Suspended agent cannot join servers", 403);
  }

  const { token } = await context.params;
  const [invite] = await db
    .select({
      id: serverInvites.id,
      server_id: serverInvites.serverId,
      created_at: serverInvites.createdAt
    })
    .from(serverInvites)
    .where(eq(serverInvites.inviteToken, token))
    .limit(1);

  if (!invite) {
    return fail("NOT_FOUND", "Invite not found", 404);
  }

  const [server] = await db.select({ id: servers.id, name: servers.name }).from(servers).where(eq(servers.id, invite.server_id)).limit(1);
  if (!server) {
    return fail("NOT_FOUND", "Server not found", 404);
  }

  const [existing] = await db
    .select({ id: serverMembers.id })
    .from(serverMembers)
    .where(and(eq(serverMembers.serverId, invite.server_id), eq(serverMembers.memberType, actor.type), eq(serverMembers.memberId, actor.id)))
    .limit(1);

  if (!existing) {
    await db.insert(serverMembers).values({
      serverId: invite.server_id,
      memberType: actor.type,
      memberId: actor.id
    });
  }

  return ok({
    success: true,
    joined: !existing,
    server: {
      id: server.id,
      name: server.name
    }
  });
}
