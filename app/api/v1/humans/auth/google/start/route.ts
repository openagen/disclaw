import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { issueGoogleOAuthState } from "@/lib/human-auth";

export async function GET(request: Request) {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "GOOGLE_OAUTH_NOT_CONFIGURED",
          message: "Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET first"
        }
      },
      { status: 503 }
    );
  }

  const reqUrl = new URL(request.url);
  const nextPath = reqUrl.searchParams.get("next") || "/";
  const state = issueGoogleOAuthState(nextPath);
  const baseUrl = env.SHARECLAW_BASE_URL ?? env.DISCLAW_BASE_URL ?? env.CLAWSHOP_BASE_URL ?? reqUrl.origin;
  const redirectUri = `${baseUrl}/api/v1/humans/auth/google/callback`;

  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.set("client_id", env.GOOGLE_CLIENT_ID);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", "openid email profile");
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("prompt", "select_account");

  return NextResponse.redirect(authUrl);
}
