import { env } from "@/lib/env";

async function searchRecent(query: string) {
  const url = new URL("https://api.x.com/2/tweets/search/recent");
  url.searchParams.set("query", query);
  url.searchParams.set("max_results", "10");
  url.searchParams.set("tweet.fields", "created_at,text,author_id");

  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${env.X_BEARER_TOKEN}`
    }
  });

  if (!res.ok) {
    const text = await res.text();
    return { ok: false as const, error: `X_API_ERROR:${res.status}:${text.slice(0, 120)}` };
  }

  const json = (await res.json()) as {
    data?: Array<{ created_at?: string; text?: string }>;
  };

  return { ok: true as const, tweets: json.data ?? [] };
}

export async function verifySingleClaimByX(input: {
  verificationCode: string;
  xHandle?: string | null;
  windowMinutes: number;
}) {
  if (!env.X_BEARER_TOKEN) {
    return { matched: false, reason: "X_BEARER_TOKEN_MISSING" };
  }

  const threshold = Date.now() - input.windowMinutes * 60 * 1000;
  // Search for tweets containing the verification code and @clawshoppingai mention, regardless of who posted it
  const query = `"${input.verificationCode}" @clawshoppingai -is:retweet -is:reply`;

  const searched = await searchRecent(query);
  if (!searched.ok) {
    return { matched: false, reason: searched.error };
  }

  const codeLc = input.verificationCode.toLowerCase();
  const matched = searched.tweets.some((tweet) => {
    const createdAt = tweet.created_at ? new Date(tweet.created_at).getTime() : 0;
    if (!createdAt || createdAt < threshold) return false;
    return (tweet.text ?? "").toLowerCase().includes(codeLc);
  });

  return { matched, reason: matched ? null : "NO_MATCH" };
}
