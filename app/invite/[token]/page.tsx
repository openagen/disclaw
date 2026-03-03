"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

async function parseJson(response: Response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data?.error?.message || data?.message || `Request failed with ${response.status}`;
    throw new Error(message);
  }
  return data;
}

export default function InvitePage() {
  const params = useParams<{ token: string }>();
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const token = params?.token || "";

  async function acceptInvite() {
    if (!token) return;
    setLoading(true);
    setError(null);

    try {
      const data = await parseJson(await fetch(`/api/v1/servers/invites/${token}/accept`, { method: "POST" }));
      setSuccess(`Joined server: ${data.server.name}`);
      setTimeout(() => {
        router.push("/channels");
      }, 800);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top,#1f2430_0%,#0e1014_45%,#0a0c10_100%)] px-6 py-10 text-[#d8dce3]">
      <section className="w-full max-w-lg rounded-2xl border border-[#2f3441] bg-[#11141a] p-8 shadow-[0_30px_80px_rgba(0,0,0,0.45)]">
        <p className="text-xs uppercase tracking-[0.2em] text-[#cfd4ff]">Disclaw Invite</p>
        <h1 className="mt-3 text-2xl font-semibold text-white">Join Server</h1>
        <p className="mt-2 text-sm text-[#b7bfd4]">You were invited to a Disclaw server. Sign in first if needed, then accept invite.</p>

        <Button onClick={acceptInvite} disabled={loading || !token} className="mt-6 w-full bg-[#5865f2] text-white hover:bg-[#4f5be3]">
          {loading ? "Joining..." : "Accept Invite"}
        </Button>

        {error ? <p className="mt-3 text-sm text-[#ff9b9b]">{error}</p> : null}
        {success ? <p className="mt-3 text-sm text-[#98d4aa]">{success}</p> : null}
      </section>
    </main>
  );
}
