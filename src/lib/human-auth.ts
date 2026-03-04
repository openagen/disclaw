import { createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from "crypto";
import { promisify } from "util";
import { env } from "@/lib/env";

const scrypt = promisify(scryptCb);
const SESSION_COOKIE = "shareclaw_human_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
const OAUTH_STATE_TTL_SECONDS = 60 * 10;

function sign(value: string): string {
  return createHmac("sha256", env.HUMAN_AUTH_SECRET).update(value).digest("base64url");
}

function serializeToken(payload: Record<string, unknown>): string {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${body}.${sign(body)}`;
}

function parseToken<T extends Record<string, unknown>>(token: string): T | null {
  const [body, signature] = token.split(".");
  if (!body || !signature) {
    return null;
  }

  const expected = sign(body);
  const sigBuf = Buffer.from(signature);
  const expectedBuf = Buffer.from(expected);

  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) {
    return null;
  }

  try {
    return JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T;
  } catch {
    return null;
  }
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt$${salt}$${derived.toString("hex")}`;
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [algo, salt, digestHex] = encoded.split("$");
  if (algo !== "scrypt" || !salt || !digestHex) {
    return false;
  }

  const derived = (await scrypt(password, salt, 64)) as Buffer;
  const expected = Buffer.from(digestHex, "hex");

  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

export function issueHumanSession(input: { humanId: string; email: string; name: string }) {
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const token = serializeToken({
    sub: input.humanId,
    email: input.email,
    name: input.name,
    exp
  });

  return {
    token,
    expiresAt: new Date(exp * 1000),
    maxAge: SESSION_TTL_SECONDS,
    cookieName: SESSION_COOKIE
  };
}

export function verifyHumanSession(token: string) {
  const parsed = parseToken<{ sub?: string; email?: string; name?: string; exp?: number }>(token);

  if (!parsed?.sub || !parsed.email || !parsed.name || !parsed.exp) {
    return null;
  }

  if (parsed.exp < Math.floor(Date.now() / 1000)) {
    return null;
  }

  return {
    humanId: parsed.sub,
    email: parsed.email,
    name: parsed.name,
    expiresAt: new Date(parsed.exp * 1000)
  };
}

export function issueGoogleOAuthState(nextPath: string) {
  const exp = Math.floor(Date.now() / 1000) + OAUTH_STATE_TTL_SECONDS;
  return serializeToken({ nextPath, nonce: randomBytes(12).toString("hex"), exp });
}

export function verifyGoogleOAuthState(state: string) {
  const parsed = parseToken<{ nextPath?: string; exp?: number }>(state);

  if (!parsed?.nextPath || !parsed.exp) {
    return null;
  }

  if (!parsed.nextPath.startsWith("/")) {
    return null;
  }

  if (parsed.exp < Math.floor(Date.now() / 1000)) {
    return null;
  }

  return { nextPath: parsed.nextPath };
}
