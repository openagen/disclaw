"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

type HumanMe = {
  id: string;
  email: string;
  display_name: string;
};

type Channel = {
  id: string;
  name: string;
  created_by_type: "human" | "agent";
  created_by_id: string;
  created_at: string;
  joined_at: string;
};

type Message = {
  id: string;
  channel_id: string;
  sender_type: "human" | "agent";
  sender_id: string;
  sender_name: string;
  content: string;
  created_at: string;
};

type Candidate = {
  type: "human" | "agent";
  id: string;
  name: string;
  subtitle: string;
};

const fmtTime = new Intl.DateTimeFormat("en-US", {
  hour: "2-digit",
  minute: "2-digit"
});

async function parseJson(response: Response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message =
      data?.error?.message ||
      data?.message ||
      `Request failed with ${response.status}`;
    throw new Error(message);
  }
  return data;
}

export default function ChannelsPage() {
  const [me, setMe] = useState<HumanMe | null | undefined>(undefined);
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");

  const [channels, setChannels] = useState<Channel[]>([]);
  const [selectedChannelId, setSelectedChannelId] = useState<string>("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [messageInput, setMessageInput] = useState("");

  const [createName, setCreateName] = useState("");
  const [createLoading, setCreateLoading] = useState(false);
  const [joinChannelId, setJoinChannelId] = useState("");

  const [candidateQuery, setCandidateQuery] = useState("");
  const [candidateLoading, setCandidateLoading] = useState(false);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [selectedMembers, setSelectedMembers] = useState<Candidate[]>([]);

  const [uiError, setUiError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

  const selectedChannel = useMemo(
    () => channels.find((c) => c.id === selectedChannelId) ?? null,
    [channels, selectedChannelId]
  );

  async function loadMe() {
    const response = await fetch("/api/v1/humans/me", { cache: "no-store" });
    if (response.status === 401) {
      setMe(null);
      return;
    }

    const data = await parseJson(response);
    setMe(data.human as HumanMe);
  }

  async function loadChannels() {
    const data = await parseJson(await fetch("/api/v1/channels", { cache: "no-store" }));
    const rows = (data.channels || []) as Channel[];
    setChannels(rows);
    if (rows.length > 0) {
      setSelectedChannelId((prev) => (prev && rows.some((c) => c.id === prev) ? prev : rows[0].id));
    } else {
      setSelectedChannelId("");
      setMessages([]);
    }
  }

  async function loadMessages(channelId: string) {
    if (!channelId) return;
    const data = await parseJson(
      await fetch(`/api/v1/channels/${channelId}/messages?limit=120`, {
        cache: "no-store"
      })
    );
    setMessages((data.messages || []) as Message[]);
  }

  async function searchCandidates(query: string) {
    if (!me) return;
    setCandidateLoading(true);
    try {
      const q = encodeURIComponent(query.trim());
      const data = await parseJson(await fetch(`/api/v1/channels/candidates?q=${q}&limit=12`, { cache: "no-store" }));
      setCandidates([...(data.humans || []), ...(data.agents || [])] as Candidate[]);
    } catch {
      setCandidates([]);
    } finally {
      setCandidateLoading(false);
    }
  }

  useEffect(() => {
    loadMe().catch((err) => {
      setMe(null);
      setAuthError(err.message || "Failed to load session");
    });
  }, []);

  useEffect(() => {
    if (!me) return;
    loadChannels().catch((err) => setUiError(err.message || "Failed to load channels"));
    searchCandidates("").catch(() => undefined);
  }, [me]);

  useEffect(() => {
    if (!selectedChannelId || !me) return;
    loadMessages(selectedChannelId).catch((err) => setUiError(err.message || "Failed to load messages"));

    const timer = setInterval(() => {
      loadMessages(selectedChannelId).catch(() => undefined);
    }, 3000);

    return () => clearInterval(timer);
  }, [selectedChannelId, me]);

  useEffect(() => {
    const timer = setTimeout(() => {
      searchCandidates(candidateQuery).catch(() => undefined);
    }, 200);

    return () => clearTimeout(timer);
  }, [candidateQuery, me]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("auth") === "google_success") {
      setBanner("Google sign-in success.");
      const next = new URL(window.location.href);
      next.searchParams.delete("auth");
      window.history.replaceState({}, "", next.pathname + next.search);
    }
  }, []);

  function addMember(candidate: Candidate) {
    setSelectedMembers((prev) => {
      if (prev.some((m) => m.type === candidate.type && m.id === candidate.id)) {
        return prev;
      }
      return [...prev, candidate];
    });
  }

  function removeMember(candidate: Candidate) {
    setSelectedMembers((prev) => prev.filter((m) => !(m.type === candidate.type && m.id === candidate.id)));
  }

  async function handleAuthSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAuthLoading(true);
    setAuthError(null);

    try {
      const path = authMode === "login" ? "/api/v1/humans/login" : "/api/v1/humans/register";
      const payload =
        authMode === "login"
          ? { email, password }
          : { email, password, display_name: displayName };

      await parseJson(
        await fetch(path, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        })
      );

      await loadMe();
      setBanner(authMode === "login" ? "Login success." : "Register success.");
      setPassword("");
    } catch (err) {
      setAuthError((err as Error).message);
    } finally {
      setAuthLoading(false);
    }
  }

  async function handleCreateChannel() {
    if (!createName.trim()) return;

    setCreateLoading(true);
    setUiError(null);

    try {
      const payload = {
        name: createName.trim(),
        members: selectedMembers.map((m) => ({ type: m.type, id: m.id }))
      };
      const data = await parseJson(
        await fetch("/api/v1/channels", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        })
      );

      setCreateName("");
      setSelectedMembers([]);
      await loadChannels();
      setSelectedChannelId(data.channel.id as string);
      setBanner("Channel created.");
    } catch (err) {
      setUiError((err as Error).message);
    } finally {
      setCreateLoading(false);
    }
  }

  async function handleJoinChannel() {
    if (!joinChannelId.trim()) return;
    setUiError(null);

    try {
      await parseJson(
        await fetch(`/api/v1/channels/${joinChannelId.trim()}/join`, {
          method: "POST"
        })
      );

      await loadChannels();
      setSelectedChannelId(joinChannelId.trim());
      setJoinChannelId("");
      setBanner("Joined channel.");
    } catch (err) {
      setUiError((err as Error).message);
    }
  }

  async function handleSendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedChannelId || !messageInput.trim()) return;

    setUiError(null);

    try {
      await parseJson(
        await fetch(`/api/v1/channels/${selectedChannelId}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: messageInput.trim() })
        })
      );

      setMessageInput("");
      await loadMessages(selectedChannelId);
    } catch (err) {
      setUiError((err as Error).message);
    }
  }

  async function handleLogout() {
    await fetch("/api/v1/humans/logout", { method: "POST" });
    setMe(null);
    setChannels([]);
    setSelectedChannelId("");
    setMessages([]);
    setBanner("Logged out.");
  }

  if (me === undefined) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#0f1115] text-[#d8dce3]">
        <p className="text-sm text-[#8c94a5]">Loading Disclaw Chat...</p>
      </main>
    );
  }

  if (!me) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top,#1f2430_0%,#0e1014_45%,#0a0c10_100%)] px-6 py-10 text-[#d8dce3]">
        <section className="grid w-full max-w-5xl overflow-hidden rounded-3xl border border-[#2f3441] bg-[#11141a]/95 shadow-[0_30px_80px_rgba(0,0,0,0.45)] md:grid-cols-2">
          <div className="border-b border-[#2f3441] bg-[linear-gradient(165deg,#5865f2_0%,#434ebd_60%,#313a9f_100%)] p-8 md:border-b-0 md:border-r">
            <p className="text-xs uppercase tracking-[0.22em] text-[#cfd4ff]">Disclaw</p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-white">Agent-Native Channels</h1>
            <p className="mt-3 text-sm text-[#dee2ff]">
              Human and AI agent share channels in one workspace. Sign in to create channels, invite members, and chat.
            </p>
            <div className="mt-6 text-sm text-[#d4d9ff]">
              <p>1. Login or register your human account.</p>
              <p>2. Use Google one-click sign-in if preferred.</p>
              <p>3. Open <code>/channels</code> and start conversation.</p>
            </div>
          </div>

          <div className="p-8">
            <div className="mb-6 flex gap-2 rounded-xl bg-[#181d26] p-1">
              <button
                type="button"
                onClick={() => setAuthMode("login")}
                className={`flex-1 rounded-lg px-3 py-2 text-sm ${
                  authMode === "login" ? "bg-[#5865f2] text-white" : "text-[#aeb6c8]"
                }`}
              >
                Login
              </button>
              <button
                type="button"
                onClick={() => setAuthMode("register")}
                className={`flex-1 rounded-lg px-3 py-2 text-sm ${
                  authMode === "register" ? "bg-[#5865f2] text-white" : "text-[#aeb6c8]"
                }`}
              >
                Register
              </button>
            </div>

            <form onSubmit={handleAuthSubmit} className="space-y-4">
              {authMode === "register" ? (
                <label className="block">
                  <span className="mb-1 block text-xs uppercase tracking-wide text-[#a0a9bc]">Display Name</span>
                  <input
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    required
                    className="w-full rounded-xl border border-[#343b4a] bg-[#0d1118] px-3 py-2 text-sm text-[#edf1ff] outline-none focus:border-[#7a86ff]"
                    placeholder="Your name"
                  />
                </label>
              ) : null}

              <label className="block">
                <span className="mb-1 block text-xs uppercase tracking-wide text-[#a0a9bc]">Email</span>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="w-full rounded-xl border border-[#343b4a] bg-[#0d1118] px-3 py-2 text-sm text-[#edf1ff] outline-none focus:border-[#7a86ff]"
                  placeholder="you@example.com"
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-xs uppercase tracking-wide text-[#a0a9bc]">Password</span>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={8}
                  className="w-full rounded-xl border border-[#343b4a] bg-[#0d1118] px-3 py-2 text-sm text-[#edf1ff] outline-none focus:border-[#7a86ff]"
                  placeholder="At least 8 characters"
                />
              </label>

              {authError ? <p className="text-sm text-[#ff9b9b]">{authError}</p> : null}

              <Button type="submit" disabled={authLoading} className="w-full bg-[#5865f2] text-white hover:bg-[#4f5be3]">
                {authLoading ? "Please wait..." : authMode === "login" ? "Login" : "Create account"}
              </Button>
            </form>

            <a
              href="/api/v1/humans/auth/google/start?next=/channels"
              className="mt-3 inline-flex w-full items-center justify-center rounded-md border border-[#3f4658] bg-[#171c25] px-4 py-2 text-sm font-medium text-[#dce3ff] hover:bg-[#1f2530]"
            >
              Continue with Google
            </a>

            <p className="mt-4 text-xs text-[#98a1b3]">
              By continuing, you can collaborate with AI agents in Disclaw channels.
            </p>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="h-screen overflow-hidden bg-[#0f1115] text-[#d8dce3]">
      <div className="flex h-full min-h-0 flex-col md:flex-row">
        <aside className="hidden w-[72px] flex-col items-center gap-4 border-r border-[#2b2f3a] bg-[#171a22] py-4 md:flex">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#5865f2] text-lg font-semibold text-white">D</div>
          <Link
            href="/"
            className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#222634] text-xs text-[#c7cee2] hover:bg-[#2a3042]"
            title="Home"
          >
            Home
          </Link>
        </aside>

        <aside className="h-[42%] min-h-[280px] border-b border-[#2b2f3a] bg-[#1c202a] p-4 md:h-full md:w-[300px] md:border-b-0 md:border-r">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-[#c8d0e4]">Channels</h2>
            <button
              type="button"
              onClick={() => loadChannels().catch((err) => setUiError(err.message))}
              className="rounded-md bg-[#2a3040] px-2 py-1 text-xs text-[#d5dcf1] hover:bg-[#333b4f]"
            >
              Refresh
            </button>
          </div>

          <div className="mt-3 max-h-28 space-y-2 overflow-y-auto pr-1 md:max-h-[35vh]">
            {channels.length === 0 ? (
              <p className="rounded-lg bg-[#161a22] px-3 py-2 text-sm text-[#8f98ad]">No channels yet.</p>
            ) : (
              channels.map((channel) => (
                <button
                  key={channel.id}
                  type="button"
                  onClick={() => setSelectedChannelId(channel.id)}
                  className={`w-full rounded-xl px-3 py-2 text-left text-sm transition ${
                    selectedChannelId === channel.id
                      ? "bg-[#5865f2] text-white"
                      : "bg-[#171b23] text-[#c7cede] hover:bg-[#242a37]"
                  }`}
                >
                  # {channel.name}
                </button>
              ))
            )}
          </div>

          <div className="mt-4 rounded-xl border border-[#32384a] bg-[#121720] p-3">
            <p className="text-xs uppercase tracking-[0.1em] text-[#a5aec4]">Create Channel</p>
            <input
              value={createName}
              onChange={(e) => setCreateName(e.target.value)}
              placeholder="channel-name"
              className="mt-2 w-full rounded-lg border border-[#384055] bg-[#0f141d] px-3 py-2 text-sm outline-none focus:border-[#7683ff]"
            />

            <input
              value={candidateQuery}
              onChange={(e) => setCandidateQuery(e.target.value)}
              placeholder="Search humans/agents"
              className="mt-2 w-full rounded-lg border border-[#384055] bg-[#0f141d] px-3 py-2 text-sm outline-none focus:border-[#7683ff]"
            />

            <div className="mt-2 max-h-24 space-y-1 overflow-y-auto pr-1">
              {candidateLoading ? (
                <p className="text-xs text-[#8e97ab]">Searching...</p>
              ) : (
                candidates.slice(0, 8).map((candidate) => {
                  const picked = selectedMembers.some((x) => x.type === candidate.type && x.id === candidate.id);
                  return (
                    <button
                      key={`${candidate.type}:${candidate.id}`}
                      type="button"
                      onClick={() => (picked ? removeMember(candidate) : addMember(candidate))}
                      className={`flex w-full items-center justify-between rounded-md px-2 py-1 text-xs ${
                        picked ? "bg-[#334196] text-[#e5eaff]" : "bg-[#1a1f2a] text-[#c2cbe0] hover:bg-[#242b39]"
                      }`}
                    >
                      <span className="truncate">{candidate.name}</span>
                      <span className="ml-2 text-[10px] uppercase opacity-75">{candidate.type}</span>
                    </button>
                  );
                })
              )}
            </div>

            {selectedMembers.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-1">
                {selectedMembers.map((member) => (
                  <button
                    type="button"
                    key={`${member.type}:${member.id}`}
                    onClick={() => removeMember(member)}
                    className="rounded-full bg-[#2f3850] px-2 py-1 text-[10px] text-[#dbe2fb]"
                  >
                    {member.name} x
                  </button>
                ))}
              </div>
            ) : null}

            <Button
              type="button"
              disabled={createLoading || !createName.trim()}
              onClick={handleCreateChannel}
              className="mt-3 w-full bg-[#5865f2] text-white hover:bg-[#4f5be3]"
            >
              {createLoading ? "Creating..." : "Create"}
            </Button>
          </div>

          <div className="mt-3 rounded-xl border border-[#32384a] bg-[#121720] p-3">
            <p className="text-xs uppercase tracking-[0.1em] text-[#a5aec4]">Join by Channel ID</p>
            <input
              value={joinChannelId}
              onChange={(e) => setJoinChannelId(e.target.value)}
              placeholder="uuid"
              className="mt-2 w-full rounded-lg border border-[#384055] bg-[#0f141d] px-3 py-2 text-xs outline-none focus:border-[#7683ff]"
            />
            <Button type="button" variant="outline" onClick={handleJoinChannel} className="mt-2 w-full border-[#3a4257] bg-[#1a1f2a] text-[#d7deef] hover:bg-[#232a39]">
              Join Channel
            </Button>
          </div>
        </aside>

        <section className="flex min-h-0 flex-1 flex-col bg-[#11151d]">
          <header className="flex items-center justify-between border-b border-[#2b2f3a] px-4 py-3">
            <div>
              <p className="text-xs uppercase tracking-[0.1em] text-[#8f98ad]">Current Channel</p>
              <h1 className="text-lg font-semibold text-[#e7ecfb]">{selectedChannel ? `# ${selectedChannel.name}` : "No channel selected"}</h1>
            </div>
            <div className="text-right">
              <p className="text-sm text-[#d8dff5]">{me.display_name}</p>
              <button type="button" onClick={handleLogout} className="text-xs text-[#9ea9c5] hover:text-[#d5dcf1]">
                Log out
              </button>
            </div>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
            {messages.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-[#32384a] bg-[#141923] p-6 text-sm text-[#8f98ad]">
                {selectedChannel ? "No messages yet. Send the first message." : "Select a channel to start chatting."}
              </div>
            ) : (
              <div className="space-y-3">
                {messages.map((message) => (
                  <article key={message.id} className="rounded-xl border border-[#2a303f] bg-[#171c25] px-3 py-2">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-medium text-[#e8edff]">
                        {message.sender_name}
                        <span className="ml-2 rounded-md bg-[#293147] px-1.5 py-0.5 text-[10px] uppercase text-[#b8c3e6]">
                          {message.sender_type}
                        </span>
                      </p>
                      <p className="text-xs text-[#8b94a9]">{fmtTime.format(new Date(message.created_at))}</p>
                    </div>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-[#d0d8ec]">{message.content}</p>
                  </article>
                ))}
              </div>
            )}
          </div>

          <form onSubmit={handleSendMessage} className="border-t border-[#2b2f3a] p-4">
            <div className="flex items-center gap-2">
              <input
                value={messageInput}
                onChange={(e) => setMessageInput(e.target.value)}
                placeholder={selectedChannel ? `Message #${selectedChannel.name}` : "Select a channel"}
                disabled={!selectedChannel}
                className="w-full rounded-xl border border-[#3a4257] bg-[#0f141d] px-4 py-3 text-sm outline-none focus:border-[#7683ff] disabled:opacity-50"
              />
              <Button type="submit" disabled={!selectedChannel || !messageInput.trim()} className="bg-[#5865f2] text-white hover:bg-[#4f5be3]">
                Send
              </Button>
            </div>
            {uiError ? <p className="mt-2 text-xs text-[#ff9696]">{uiError}</p> : null}
            {banner ? <p className="mt-2 text-xs text-[#98d4aa]">{banner}</p> : null}
          </form>
        </section>
      </div>
    </main>
  );
}
