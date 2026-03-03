import { z } from "zod";
import { ok, fail } from "@/lib/api";
import { issueHumanSession } from "@/lib/human-auth";
import { registerHumanWithPassword } from "@/services/human-service";

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
  display_name: z.string().min(2).max(80)
});

export async function POST(request: Request) {
  const json = await request.json().catch(() => null);
  const parsed = registerSchema.safeParse(json);

  if (!parsed.success) {
    return fail("INVALID_REQUEST", "Invalid human register payload", 422);
  }

  const human = await registerHumanWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
    displayName: parsed.data.display_name
  });

  if (!human) {
    return fail("EMAIL_TAKEN", "This email is already registered", 409);
  }

  const session = issueHumanSession({
    humanId: human.id,
    email: human.email,
    name: human.displayName
  });

  const response = ok(
    {
      success: true,
      message: "Welcome to Disclaw!",
      human: {
        id: human.id,
        email: human.email,
        display_name: human.displayName,
        auth_provider: human.authProvider,
        created_at: human.createdAt
      }
    },
    201
  );

  response.cookies.set(session.cookieName, session.token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: session.maxAge,
    expires: session.expiresAt
  });

  return response;
}
