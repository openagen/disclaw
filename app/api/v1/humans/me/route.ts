import { ok, fail } from "@/lib/api";
import { verifyHumanSession } from "@/lib/human-auth";
import { cookies } from "next/headers";

export async function GET() {
  const cookieStore = await cookies();
  const token = cookieStore.get("disclaw_human_session")?.value;

  if (!token) {
    return fail("UNAUTHORIZED", "No session found", 401);
  }

  const session = verifyHumanSession(token);
  if (!session) {
    return fail("UNAUTHORIZED", "Invalid or expired session", 401);
  }

  return ok({
    success: true,
    human: {
      id: session.humanId,
      email: session.email,
      display_name: session.name,
      session_expires_at: session.expiresAt
    }
  });
}
