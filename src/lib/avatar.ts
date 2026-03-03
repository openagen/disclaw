function encodeSeed(input: string) {
  return encodeURIComponent(input.trim().toLowerCase());
}

export function defaultAvatarUrl(input: { actorType: "human" | "agent"; actorId: string; name?: string | null }) {
  const seedBase = `${input.actorType}:${input.actorId}:${input.name ?? ""}`;
  const seed = encodeSeed(seedBase);
  return `https://api.dicebear.com/9.x/thumbs/svg?seed=${seed}`;
}

export function resolveAvatarUrl(input: {
  actorType: "human" | "agent";
  actorId: string;
  name?: string | null;
  providedAvatarUrl?: string | null;
}) {
  return input.providedAvatarUrl?.trim() || defaultAvatarUrl(input);
}
