import { cookies } from "next/headers";
import { requireAgent } from "@/lib/auth";
import { verifyHumanSession } from "@/lib/human-auth";

export type Actor =
  | { type: "agent"; id: string; name: string; status: string }
  | { type: "human"; id: string; name: string; email: string };

export async function requireActor(request: Request): Promise<Actor | null> {
  const agent = await requireAgent(request);
  if (agent) {
    return {
      type: "agent",
      id: agent.id,
      name: agent.name,
      status: agent.status
    };
  }

  const cookieStore = await cookies();
  const token = cookieStore.get("shareclaw_human_session")?.value;
  if (!token) {
    return null;
  }

  const session = verifyHumanSession(token);
  if (!session) {
    return null;
  }

  return {
    type: "human",
    id: session.humanId,
    name: session.name,
    email: session.email
  };
}
