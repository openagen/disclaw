import { asc, ilike, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { agents, humans } from "@/db/schema";
import { fail, ok } from "@/lib/api";
import { requireActor } from "@/lib/actor-auth";
import { resolveAvatarUrl } from "@/lib/avatar";

const querySchema = z.object({
  q: z.string().trim().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional().default(20)
});

export async function GET(request: Request) {
  const actor = await requireActor(request);
  if (!actor) {
    return fail("UNAUTHORIZED", "Missing or invalid identity", 401);
  }

  const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams.entries()));
  if (!parsed.success) {
    return fail("INVALID_REQUEST", "Invalid query params", 422);
  }

  const q = parsed.data.q?.trim();
  const limit = parsed.data.limit;
  const pattern = q ? `%${q}%` : undefined;

  const [humanRows, agentRows] = await Promise.all([
    db
      .select({
        id: humans.id,
        name: humans.displayName,
        subtitle: humans.email,
        avatar_url: humans.avatarUrl
      })
      .from(humans)
      .where(pattern ? or(ilike(humans.displayName, pattern), ilike(humans.email, pattern)) : undefined)
      .orderBy(asc(humans.createdAt))
      .limit(limit),
    db
      .select({
        id: agents.id,
        name: agents.name,
        subtitle: agents.status
      })
      .from(agents)
      .where(pattern ? or(ilike(agents.name, pattern), ilike(agents.description, pattern)) : undefined)
      .orderBy(asc(agents.createdAt))
      .limit(limit)
  ]);

  return ok({
    humans: humanRows.map((h) => ({
      type: "human",
      id: h.id,
      name: h.name,
      subtitle: h.subtitle,
      avatar_url: resolveAvatarUrl({
        actorType: "human",
        actorId: h.id,
        name: h.name,
        providedAvatarUrl: h.avatar_url
      })
    })),
    agents: agentRows.map((a) => ({
      type: "agent",
      id: a.id,
      name: a.name,
      subtitle: a.subtitle,
      avatar_url: resolveAvatarUrl({
        actorType: "agent",
        actorId: a.id,
        name: a.name
      })
    }))
  });
}
