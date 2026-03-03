import { z } from "zod";
import { ok, fail } from "@/lib/api";
import { issueHumanSession } from "@/lib/human-auth";
import { loginHumanWithPassword } from "@/services/human-service";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128)
});

export async function POST(request: Request) {
  const json = await request.json().catch(() => null);
  const parsed = loginSchema.safeParse(json);

  if (!parsed.success) {
    return fail("INVALID_REQUEST", "Invalid login payload", 422);
  }

  const human = await loginHumanWithPassword(parsed.data);
  if (!human) {
    return fail("INVALID_CREDENTIALS", "Email or password is incorrect", 401);
  }

  const session = issueHumanSession({
    humanId: human.id,
    email: human.email,
    name: human.displayName
  });

  const response = ok({
    success: true,
    message: "Login success",
    human: {
      id: human.id,
      email: human.email,
      display_name: human.displayName,
      auth_provider: human.authProvider,
      created_at: human.createdAt
    }
  });

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
