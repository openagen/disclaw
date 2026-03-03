import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { humans } from "@/db/schema";
import { hashPassword, verifyPassword } from "@/lib/human-auth";

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function registerHumanWithPassword(input: {
  email: string;
  password: string;
  displayName: string;
}) {
  const passwordHash = await hashPassword(input.password);
  const normalizedEmail = normalizeEmail(input.email);

  const [human] = await db
    .insert(humans)
    .values({
      email: normalizedEmail,
      displayName: input.displayName,
      passwordHash,
      authProvider: "password"
    })
    .onConflictDoNothing()
    .returning({
      id: humans.id,
      email: humans.email,
      displayName: humans.displayName,
      authProvider: humans.authProvider,
      createdAt: humans.createdAt
    });

  return human ?? null;
}

export async function loginHumanWithPassword(input: { email: string; password: string }) {
  const normalizedEmail = normalizeEmail(input.email);
  const [human] = await db
    .select({
      id: humans.id,
      email: humans.email,
      displayName: humans.displayName,
      passwordHash: humans.passwordHash,
      authProvider: humans.authProvider,
      createdAt: humans.createdAt
    })
    .from(humans)
    .where(eq(humans.email, normalizedEmail))
    .limit(1);

  if (!human?.passwordHash) {
    return null;
  }

  const valid = await verifyPassword(input.password, human.passwordHash);
  if (!valid) {
    return null;
  }

  return {
    id: human.id,
    email: human.email,
    displayName: human.displayName,
    authProvider: human.authProvider,
    createdAt: human.createdAt
  };
}

export async function upsertGoogleHuman(input: {
  googleSub: string;
  email: string;
  displayName: string;
  avatarUrl?: string | null;
}) {
  const normalizedEmail = normalizeEmail(input.email);

  const [existingBySub] = await db
    .select({ id: humans.id })
    .from(humans)
    .where(eq(humans.googleSub, input.googleSub))
    .limit(1);

  if (existingBySub) {
    const [updated] = await db
      .update(humans)
      .set({
        email: normalizedEmail,
        displayName: input.displayName,
        avatarUrl: input.avatarUrl ?? null,
        authProvider: "google"
      })
      .where(eq(humans.id, existingBySub.id))
      .returning({
        id: humans.id,
        email: humans.email,
        displayName: humans.displayName,
        authProvider: humans.authProvider,
        createdAt: humans.createdAt
      });

    return updated;
  }

  const [existingByEmail] = await db
    .select({ id: humans.id })
    .from(humans)
    .where(eq(humans.email, normalizedEmail))
    .limit(1);

  if (existingByEmail) {
    const [merged] = await db
      .update(humans)
      .set({
        googleSub: input.googleSub,
        displayName: input.displayName,
        avatarUrl: input.avatarUrl ?? null,
        authProvider: "google"
      })
      .where(eq(humans.id, existingByEmail.id))
      .returning({
        id: humans.id,
        email: humans.email,
        displayName: humans.displayName,
        authProvider: humans.authProvider,
        createdAt: humans.createdAt
      });

    return merged;
  }

  const [created] = await db
    .insert(humans)
    .values({
      email: normalizedEmail,
      displayName: input.displayName,
      googleSub: input.googleSub,
      avatarUrl: input.avatarUrl ?? null,
      authProvider: "google"
    })
    .returning({
      id: humans.id,
      email: humans.email,
      displayName: humans.displayName,
      authProvider: humans.authProvider,
      createdAt: humans.createdAt
    });

  return created;
}
