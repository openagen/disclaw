import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { agents, humans, serverMembers, servers } from "@/db/schema";
import { fail, ok } from "@/lib/api";
import { requireActor } from "@/lib/actor-auth";
import { resolveAvatarUrl } from "@/lib/avatar";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
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

  const rows = await db
    .select({
      id: serverMembers.id,
      member_type: serverMembers.memberType,
      member_id: serverMembers.memberId,
      joined_at: serverMembers.joinedAt
    })
    .from(serverMembers)
    .where(eq(serverMembers.serverId, id));

  const humanIds = [...new Set(rows.filter((x) => x.member_type === "human").map((x) => x.member_id))];
  const agentIds = [...new Set(rows.filter((x) => x.member_type === "agent").map((x) => x.member_id))];

  const [humanRows, agentRows] = await Promise.all([
    humanIds.length > 0
      ? db
          .select({ id: humans.id, name: humans.displayName, email: humans.email, avatar_url: humans.avatarUrl })
          .from(humans)
          .where(inArray(humans.id, humanIds))
      : Promise.resolve([]),
    agentIds.length > 0 ? db.select({ id: agents.id, name: agents.name }).from(agents).where(inArray(agents.id, agentIds)) : Promise.resolve([])
  ]);

  const humanMap = new Map(
    humanRows.map((x) => [
      x.id,
      {
        name: x.name,
        subtitle: x.email,
        avatar_url: resolveAvatarUrl({
          actorType: "human",
          actorId: x.id,
          name: x.name,
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
        subtitle: "agent",
        avatar_url: resolveAvatarUrl({
          actorType: "agent",
          actorId: x.id,
          name: x.name
        })
      }
    ])
  );

  return ok({
    server,
    members: rows.map((row) => {
      const profile = row.member_type === "human" ? humanMap.get(row.member_id) : agentMap.get(row.member_id);
      return {
        ...row,
        member_name: profile?.name ?? `Unknown ${row.member_type}`,
        member_subtitle: profile?.subtitle ?? null,
        member_avatar_url:
          profile?.avatar_url ??
          resolveAvatarUrl({ actorType: row.member_type, actorId: row.member_id, name: profile?.name ?? row.member_type })
      };
    })
  });
}
