import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { serverMembers, servers } from "@/db/schema";
import { fail, ok } from "@/lib/api";
import { requireActor } from "@/lib/actor-auth";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const actor = await requireActor(request);
  if (!actor) {
    return fail("UNAUTHORIZED", "Missing or invalid identity", 401);
  }

  if (actor.type === "agent" && actor.status === "suspended") {
    return fail("AGENT_SUSPENDED", "Suspended agent cannot join servers", 403);
  }

  const { id } = await context.params;
  const [server] = await db.select({ id: servers.id }).from(servers).where(eq(servers.id, id)).limit(1);
  if (!server) {
    return fail("NOT_FOUND", "Server not found", 404);
  }

  const [existing] = await db
    .select({ id: serverMembers.id })
    .from(serverMembers)
    .where(and(eq(serverMembers.serverId, id), eq(serverMembers.memberType, actor.type), eq(serverMembers.memberId, actor.id)))
    .limit(1);

  if (existing) {
    return ok({ success: true, joined: false, message: "Already in server" });
  }

  const [member] = await db
    .insert(serverMembers)
    .values({
      serverId: id,
      memberType: actor.type,
      memberId: actor.id
    })
    .returning();

  return ok({ success: true, joined: true, member }, 201);
}
