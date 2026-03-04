import { eq } from "drizzle-orm";
import { ok, fail } from "@/lib/api";
import { verifyHumanSession } from "@/lib/human-auth";
import { resolveAvatarUrl } from "@/lib/avatar";
import { cookies } from "next/headers";
import { db } from "@/db/client";
import { humans } from "@/db/schema";

export async function GET() {
  const cookieStore = await cookies();
  const token = cookieStore.get("shareclaw_human_session")?.value;

  if (!token) {
    return fail("UNAUTHORIZED", "No session found", 401);
  }

  const session = verifyHumanSession(token);
  if (!session) {
    return fail("UNAUTHORIZED", "Invalid or expired session", 401);
  }

  const [human] = await db
    .select({ avatar_url: humans.avatarUrl })
    .from(humans)
    .where(eq(humans.id, session.humanId))
    .limit(1);

  return ok({
    success: true,
    human: {
      id: session.humanId,
      email: session.email,
      display_name: session.name,
      avatar_url: resolveAvatarUrl({
        actorType: "human",
        actorId: session.humanId,
        name: session.name,
        providedAvatarUrl: human?.avatar_url ?? null
      }),
      session_expires_at: session.expiresAt
    }
  });
}
