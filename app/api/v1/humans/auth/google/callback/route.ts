import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { issueHumanSession, verifyGoogleOAuthState } from "@/lib/human-auth";
import { upsertGoogleHuman } from "@/services/human-service";

type GoogleTokenResponse = {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
  scope?: string;
  id_token?: string;
};

type GoogleUserInfo = {
  sub?: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
};

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
  const code = reqUrl.searchParams.get("code");
  const state = reqUrl.searchParams.get("state");

  if (!code || !state) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "INVALID_REQUEST",
          message: "Missing code or state"
        }
      },
      { status: 400 }
    );
  }

  const verifiedState = verifyGoogleOAuthState(state);
  if (!verifiedState) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "INVALID_STATE",
          message: "Google OAuth state is invalid or expired"
        }
      },
      { status: 400 }
    );
  }

  const baseUrl = env.DISCLAW_BASE_URL ?? env.CLAWSHOP_BASE_URL ?? reqUrl.origin;
  const redirectUri = `${baseUrl}/api/v1/humans/auth/google/callback`;

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: "authorization_code"
    })
  });

  if (!tokenRes.ok) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "GOOGLE_TOKEN_EXCHANGE_FAILED",
          message: "Failed to exchange authorization code"
        }
      },
      { status: 502 }
    );
  }

  const tokenJson = (await tokenRes.json()) as GoogleTokenResponse;
  if (!tokenJson.access_token) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "GOOGLE_TOKEN_EXCHANGE_FAILED",
          message: "Google did not return access token"
        }
      },
      { status: 502 }
    );
  }

  const profileRes = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${tokenJson.access_token}` }
  });

  if (!profileRes.ok) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "GOOGLE_PROFILE_FAILED",
          message: "Failed to fetch Google profile"
        }
      },
      { status: 502 }
    );
  }

  const profile = (await profileRes.json()) as GoogleUserInfo;
  if (!profile.sub || !profile.email || !profile.email_verified) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "GOOGLE_PROFILE_INVALID",
          message: "Google account email is unavailable or not verified"
        }
      },
      { status: 422 }
    );
  }

  const human = await upsertGoogleHuman({
    googleSub: profile.sub,
    email: profile.email,
    displayName: profile.name || profile.email,
    avatarUrl: profile.picture ?? null
  });

  const session = issueHumanSession({
    humanId: human.id,
    email: human.email,
    name: human.displayName
  });

  const destination = new URL(verifiedState.nextPath, baseUrl);
  destination.searchParams.set("auth", "google_success");

  const response = NextResponse.redirect(destination);
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
