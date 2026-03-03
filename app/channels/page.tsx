"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { io, Socket } from "socket.io-client";
import { Button } from "@/components/ui/button";

type HumanMe = {
  id: string;
  email: string;
  display_name: string;
};

type Server = {
  id: string;
  name: string;
  created_by_type: "human" | "agent";
  created_by_id: string;
  created_at: string;
  joined_at: string;
};

type Channel = {
  id: string;
  server_id: string | null;
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

type ChannelMember = {
  id: string;
  member_type: "human" | "agent";
  member_id: string;
  member_name: string;
  member_subtitle: string | null;
  joined_at: string;
  removable_by_actor: boolean;
};

type ServerMember = {
  id: string;
  member_type: "human" | "agent";
  member_id: string;
  member_name: string;
  member_subtitle: string | null;
  joined_at: string;
};

const fmtTime = new Intl.DateTimeFormat("en-US", {
  hour: "2-digit",
  minute: "2-digit"
});

function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "S";
}

async function parseJson(response: Response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data?.error?.message || data?.message || `Request failed with ${response.status}`;
    throw new Error(message);
  }
  return data;
}

export default function ChannelsPage() {
  const socketRef = useRef<Socket | null>(null);
  const subscribedChannelIdRef = useRef<string>("");
  const activeChannelIdRef = useRef<string>("");

  const [me, setMe] = useState<HumanMe | null | undefined>(undefined);
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");

  const [servers, setServers] = useState<Server[]>([]);
  const [selectedServerId, setSelectedServerId] = useState<string>("");
  const [channels, setChannels] = useState<Channel[]>([]);
  const [selectedChannelId, setSelectedChannelId] = useState<string>("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [members, setMembers] = useState<ChannelMember[]>([]);
  const [serverMembers, setServerMembers] = useState<ServerMember[]>([]);
  const [messageInput, setMessageInput] = useState("");

  const [createServerName, setCreateServerName] = useState("");
  const [createServerLoading, setCreateServerLoading] = useState(false);
  const [joinServerId, setJoinServerId] = useState("");

  const [createName, setCreateName] = useState("");
  const [createLoading, setCreateLoading] = useState(false);
  const [joinChannelId, setJoinChannelId] = useState("");

  const [candidateQuery, setCandidateQuery] = useState("");
  const [candidateLoading, setCandidateLoading] = useState(false);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [selectedServerInvitees, setSelectedServerInvitees] = useState<Candidate[]>([]);
  const [selectedChannelMembers, setSelectedChannelMembers] = useState<Candidate[]>([]);

  const [uiError, setUiError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

  const selectedServer = useMemo(() => servers.find((s) => s.id === selectedServerId) ?? null, [servers, selectedServerId]);
  const selectedChannel = useMemo(() => channels.find((c) => c.id === selectedChannelId) ?? null, [channels, selectedChannelId]);

  const serverMemberCandidates = useMemo<Candidate[]>(
    () =>
      serverMembers.map((member) => ({
        type: member.member_type,
        id: member.member_id,
        name: member.member_name,
        subtitle: member.member_subtitle ?? member.member_type
      })),
    [serverMembers]
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

  async function loadServers() {
    const data = await parseJson(await fetch("/api/v1/servers", { cache: "no-store" }));
    const rows = (data.servers || []) as Server[];
    setServers(rows);

    if (rows.length === 0) {
      setSelectedServerId("");
      setChannels([]);
      setSelectedChannelId("");
      setMessages([]);
      setMembers([]);
      setServerMembers([]);
      return;
    }

    setSelectedServerId((prev) => (prev && rows.some((s) => s.id === prev) ? prev : rows[0].id));
  }

  async function loadChannels(serverId: string) {
    if (!serverId) {
      setChannels([]);
      setSelectedChannelId("");
      setMessages([]);
      setMembers([]);
      return;
    }

    const data = await parseJson(await fetch(`/api/v1/channels?server_id=${serverId}`, { cache: "no-store" }));
    const rows = (data.channels || []) as Channel[];
    setChannels(rows);

    if (rows.length === 0) {
      setSelectedChannelId("");
      setMessages([]);
      setMembers([]);
      return;
    }

    setSelectedChannelId((prev) => (prev && rows.some((c) => c.id === prev) ? prev : rows[0].id));
  }

  async function loadServerMembers(serverId: string) {
    if (!serverId) {
      setServerMembers([]);
      setSelectedChannelMembers([]);
      return;
    }

    const data = await parseJson(await fetch(`/api/v1/servers/${serverId}/members`, { cache: "no-store" }));
    setServerMembers((data.members || []) as ServerMember[]);
  }

  async function loadMessages(channelId: string) {
    if (!channelId) return;
    const data = await parseJson(await fetch(`/api/v1/channels/${channelId}/messages?limit=120`, { cache: "no-store" }));
    setMessages((data.messages || []) as Message[]);
  }

  async function loadMembers(channelId: string) {
    if (!channelId) return;
    const data = await parseJson(await fetch(`/api/v1/channels/${channelId}/members`, { cache: "no-store" }));
    setMembers((data.members || []) as ChannelMember[]);
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
    loadServers().catch((err) => setUiError(err.message || "Failed to load servers"));
    searchCandidates("").catch(() => undefined);
  }, [me]);

  useEffect(() => {
    if (!me || !selectedServerId) return;
    loadChannels(selectedServerId).catch((err) => setUiError(err.message || "Failed to load channels"));
    loadServerMembers(selectedServerId).catch((err) => setUiError(err.message || "Failed to load server members"));
    setSelectedChannelMembers([]);
  }, [me, selectedServerId]);

  useEffect(() => {
    if (!me || !selectedChannelId) return;
    loadMessages(selectedChannelId).catch((err) => setUiError(err.message || "Failed to load messages"));
    loadMembers(selectedChannelId).catch((err) => setUiError(err.message || "Failed to load members"));
  }, [me, selectedChannelId]);

  useEffect(() => {
    const timer = setTimeout(() => {
      searchCandidates(candidateQuery).catch(() => undefined);
    }, 220);

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

  useEffect(() => {
    if (!me) return;

    let mounted = true;

    (async () => {
      await fetch("/api/socket").catch(() => undefined);
      if (!mounted) return;

      const socket = io({ path: "/api/socket/io" });
      socketRef.current = socket;

      socket.on("connect", () => {
        if (subscribedChannelIdRef.current) {
          socket.emit("subscribe_channel", subscribedChannelIdRef.current);
        }
      });

      socket.on("channel_message", (message: Message) => {
        setMessages((prev) => {
          if (message.channel_id !== activeChannelIdRef.current) {
            return prev;
          }
          if (prev.some((m) => m.id === message.id)) {
            return prev;
          }
          return [...prev, message];
        });
      });
    })();

    return () => {
      mounted = false;
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
      socketRef.current = null;
      subscribedChannelIdRef.current = "";
    };
  }, [me]);

  useEffect(() => {
    activeChannelIdRef.current = selectedChannelId;

    const socket = socketRef.current;
    if (!socket) return;

    const prev = subscribedChannelIdRef.current;
    if (prev && prev !== selectedChannelId) {
      socket.emit("unsubscribe_channel", prev);
    }

    subscribedChannelIdRef.current = selectedChannelId;

    if (!socket.connected) return;

    if (selectedChannelId) {
      socket.emit("subscribe_channel", selectedChannelId);
    }
  }, [selectedChannelId]);

  function addServerInvitee(candidate: Candidate) {
    setSelectedServerInvitees((prev) => {
      if (prev.some((m) => m.type === candidate.type && m.id === candidate.id)) {
        return prev;
      }
      return [...prev, candidate];
    });
  }

  function removeServerInvitee(candidate: Candidate) {
    setSelectedServerInvitees((prev) => prev.filter((m) => !(m.type === candidate.type && m.id === candidate.id)));
  }

  function addChannelMember(candidate: Candidate) {
    setSelectedChannelMembers((prev) => {
      if (prev.some((m) => m.type === candidate.type && m.id === candidate.id)) {
        return prev;
      }
      return [...prev, candidate];
    });
  }

  function removeChannelMember(candidate: Candidate) {
    setSelectedChannelMembers((prev) => prev.filter((m) => !(m.type === candidate.type && m.id === candidate.id)));
  }

  async function handleAuthSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAuthLoading(true);
    setAuthError(null);

    try {
      const path = authMode === "login" ? "/api/v1/humans/login" : "/api/v1/humans/register";
      const payload = authMode === "login" ? { email, password } : { email, password, display_name: displayName };

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

  async function handleCreateServer() {
    if (!createServerName.trim()) return;

    setCreateServerLoading(true);
    setUiError(null);

    try {
      const data = await parseJson(
        await fetch("/api/v1/servers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: createServerName.trim(),
            members: selectedServerInvitees.map((m) => ({ type: m.type, id: m.id }))
          })
        })
      );

      setCreateServerName("");
      setSelectedServerInvitees([]);
      await loadServers();
      setSelectedServerId(data.server.id as string);
      setBanner("Server created.");
    } catch (err) {
      setUiError((err as Error).message);
    } finally {
      setCreateServerLoading(false);
    }
  }

  async function handleJoinServer() {
    if (!joinServerId.trim()) return;
    setUiError(null);

    try {
      await parseJson(
        await fetch(`/api/v1/servers/${joinServerId.trim()}/join`, {
          method: "POST"
        })
      );

      await loadServers();
      setSelectedServerId(joinServerId.trim());
      setJoinServerId("");
      setBanner("Joined server.");
    } catch (err) {
      setUiError((err as Error).message);
    }
  }

  async function handleCreateChannel() {
    if (!selectedServerId || !createName.trim()) return;

    setCreateLoading(true);
    setUiError(null);

    try {
      const payload = {
        server_id: selectedServerId,
        name: createName.trim(),
        members: selectedChannelMembers.map((m) => ({ type: m.type, id: m.id }))
      };
      const data = await parseJson(
        await fetch("/api/v1/channels", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        })
      );

      setCreateName("");
      setSelectedChannelMembers([]);
      await loadChannels(selectedServerId);
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

      if (selectedServerId) {
        await loadChannels(selectedServerId);
      }
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
      const data = await parseJson(
        await fetch(`/api/v1/channels/${selectedChannelId}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: messageInput.trim() })
        })
      );

      setMessageInput("");
      const message = data.message as Message;
      setMessages((prev) => (prev.some((m) => m.id === message.id) ? prev : [...prev, message]));
    } catch (err) {
      setUiError((err as Error).message);
    }
  }

  async function handleRemoveMember(member: ChannelMember) {
    if (!selectedChannelId) return;

    setUiError(null);

    try {
      await parseJson(
        await fetch(`/api/v1/channels/${selectedChannelId}/members`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            member_type: member.member_type,
            member_id: member.member_id
          })
        })
      );

      setBanner("Member removed.");

      if (member.member_type === "human" && member.member_id === me?.id) {
        if (selectedServerId) {
          await loadChannels(selectedServerId);
        }
      } else {
        await loadMembers(selectedChannelId);
      }
    } catch (err) {
      setUiError((err as Error).message);
    }
  }

  async function handleLogout() {
    await fetch("/api/v1/humans/logout", { method: "POST" });
    if (socketRef.current) {
      socketRef.current.disconnect();
    }
    socketRef.current = null;
    subscribedChannelIdRef.current = "";
    setMe(null);
    setServers([]);
    setSelectedServerId("");
    setChannels([]);
    setSelectedChannelId("");
    setMessages([]);
    setMembers([]);
    setServerMembers([]);
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
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-white">Server + Channel Workspace</h1>
            <p className="mt-3 text-sm text-[#dee2ff]">
              Create servers, switch context, and chat in server-scoped channels with humans and AI agents.
            </p>
          </div>

          <div className="p-8">
            <div className="mb-6 flex gap-2 rounded-xl bg-[#181d26] p-1">
              <button
                type="button"
                onClick={() => setAuthMode("login")}
                className={`flex-1 rounded-lg px-3 py-2 text-sm ${authMode === "login" ? "bg-[#5865f2] text-white" : "text-[#aeb6c8]"}`}
              >
                Login
              </button>
              <button
                type="button"
                onClick={() => setAuthMode("register")}
                className={`flex-1 rounded-lg px-3 py-2 text-sm ${authMode === "register" ? "bg-[#5865f2] text-white" : "text-[#aeb6c8]"}`}
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
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="h-screen overflow-hidden bg-[#0f1115] text-[#d8dce3]">
      <div className="flex h-full min-h-0 flex-col md:flex-row">
        <aside className="hidden w-[84px] flex-col items-center gap-3 border-r border-[#2b2f3a] bg-[#171a22] py-4 md:flex">
          <Link
            href="/"
            className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#222634] text-xs text-[#c7cee2] hover:bg-[#2a3042]"
            title="Home"
          >
            Home
          </Link>

          <div className="h-px w-8 bg-[#313544]" />

          <button
            type="button"
            onClick={() => loadServers().catch((err) => setUiError(err.message))}
            className="flex h-11 w-11 items-center justify-center rounded-2xl border border-dashed border-[#4a5166] text-xl text-[#b8c2dc] hover:bg-[#252b3b]"
            title="Refresh servers"
          >
            +
          </button>

          <div className="flex w-full flex-1 flex-col items-center gap-2 overflow-y-auto pb-2">
            {servers.map((server) => (
              <button
                key={server.id}
                type="button"
                onClick={() => setSelectedServerId(server.id)}
                title={server.name}
                className={`flex h-11 w-11 items-center justify-center rounded-2xl text-xs font-semibold transition ${
                  selectedServerId === server.id
                    ? "bg-[#5865f2] text-white"
                    : "bg-[#242a37] text-[#cad2e8] hover:bg-[#2f3747]"
                }`}
              >
                {initials(server.name)}
              </button>
            ))}
          </div>
        </aside>

        <aside className="h-[50%] min-h-[300px] border-b border-[#2b2f3a] bg-[#1c202a] p-4 md:h-full md:w-[320px] md:border-b-0 md:border-r">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-[#c8d0e4]">Servers</h2>
            <button
              type="button"
              onClick={() => loadServers().catch((err) => setUiError(err.message))}
              className="rounded-md bg-[#2a3040] px-2 py-1 text-xs text-[#d5dcf1] hover:bg-[#333b4f]"
            >
              Refresh
            </button>
          </div>

          <p className="mt-2 text-sm text-[#a6afc4]">{selectedServer ? `Selected: ${selectedServer.name}` : "No server selected"}</p>

          <div className="mt-3 rounded-xl border border-[#32384a] bg-[#121720] p-3">
            <p className="text-xs uppercase tracking-[0.1em] text-[#a5aec4]">Create Server</p>
            <input
              value={createServerName}
              onChange={(e) => setCreateServerName(e.target.value)}
              placeholder="server-name"
              className="mt-2 w-full rounded-lg border border-[#384055] bg-[#0f141d] px-3 py-2 text-sm outline-none focus:border-[#7683ff]"
            />

            <input
              value={candidateQuery}
              onChange={(e) => setCandidateQuery(e.target.value)}
              placeholder="Invite humans/agents"
              className="mt-2 w-full rounded-lg border border-[#384055] bg-[#0f141d] px-3 py-2 text-sm outline-none focus:border-[#7683ff]"
            />

            <div className="mt-2 max-h-24 space-y-1 overflow-y-auto pr-1">
              {candidateLoading ? (
                <p className="text-xs text-[#8e97ab]">Searching...</p>
              ) : (
                candidates.slice(0, 8).map((candidate) => {
                  const picked = selectedServerInvitees.some((x) => x.type === candidate.type && x.id === candidate.id);
                  return (
                    <button
                      key={`${candidate.type}:${candidate.id}`}
                      type="button"
                      onClick={() => (picked ? removeServerInvitee(candidate) : addServerInvitee(candidate))}
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

            {selectedServerInvitees.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-1">
                {selectedServerInvitees.map((member) => (
                  <button
                    type="button"
                    key={`${member.type}:${member.id}`}
                    onClick={() => removeServerInvitee(member)}
                    className="rounded-full bg-[#2f3850] px-2 py-1 text-[10px] text-[#dbe2fb]"
                  >
                    {member.name} x
                  </button>
                ))}
              </div>
            ) : null}

            <Button
              type="button"
              disabled={createServerLoading || !createServerName.trim()}
              onClick={handleCreateServer}
              className="mt-3 w-full bg-[#5865f2] text-white hover:bg-[#4f5be3]"
            >
              {createServerLoading ? "Creating..." : "Create Server"}
            </Button>
          </div>

          <div className="mt-3 rounded-xl border border-[#32384a] bg-[#121720] p-3">
            <p className="text-xs uppercase tracking-[0.1em] text-[#a5aec4]">Join Server by ID</p>
            <input
              value={joinServerId}
              onChange={(e) => setJoinServerId(e.target.value)}
              placeholder="server uuid"
              className="mt-2 w-full rounded-lg border border-[#384055] bg-[#0f141d] px-3 py-2 text-xs outline-none focus:border-[#7683ff]"
            />
            <Button
              type="button"
              variant="outline"
              onClick={handleJoinServer}
              className="mt-2 w-full border-[#3a4257] bg-[#1a1f2a] text-[#d7deef] hover:bg-[#232a39]"
            >
              Join Server
            </Button>
          </div>

          <div className="mt-4 flex items-center justify-between">
            <h3 className="text-sm font-semibold uppercase tracking-[0.12em] text-[#c8d0e4]">Channels</h3>
            <button
              type="button"
              onClick={() => selectedServerId && loadChannels(selectedServerId).catch((err) => setUiError(err.message))}
              className="rounded-md bg-[#2a3040] px-2 py-1 text-xs text-[#d5dcf1] hover:bg-[#333b4f]"
            >
              Refresh
            </button>
          </div>

          <div className="mt-3 max-h-24 space-y-2 overflow-y-auto pr-1 md:max-h-[20vh]">
            {channels.length === 0 ? (
              <p className="rounded-lg bg-[#161a22] px-3 py-2 text-sm text-[#8f98ad]">No channels in this server.</p>
            ) : (
              channels.map((channel) => (
                <button
                  key={channel.id}
                  type="button"
                  onClick={() => setSelectedChannelId(channel.id)}
                  className={`w-full rounded-xl px-3 py-2 text-left text-sm transition ${
                    selectedChannelId === channel.id ? "bg-[#5865f2] text-white" : "bg-[#171b23] text-[#c7cede] hover:bg-[#242a37]"
                  }`}
                >
                  # {channel.name}
                </button>
              ))
            )}
          </div>

          <div className="mt-3 rounded-xl border border-[#32384a] bg-[#121720] p-3">
            <p className="text-xs uppercase tracking-[0.1em] text-[#a5aec4]">Create Channel</p>
            <input
              value={createName}
              onChange={(e) => setCreateName(e.target.value)}
              placeholder="channel-name"
              disabled={!selectedServerId}
              className="mt-2 w-full rounded-lg border border-[#384055] bg-[#0f141d] px-3 py-2 text-sm outline-none focus:border-[#7683ff] disabled:opacity-50"
            />

            <div className="mt-2 max-h-20 space-y-1 overflow-y-auto pr-1">
              {serverMemberCandidates.slice(0, 12).map((candidate) => {
                const picked = selectedChannelMembers.some((x) => x.type === candidate.type && x.id === candidate.id);
                return (
                  <button
                    key={`${candidate.type}:${candidate.id}`}
                    type="button"
                    onClick={() => (picked ? removeChannelMember(candidate) : addChannelMember(candidate))}
                    className={`flex w-full items-center justify-between rounded-md px-2 py-1 text-xs ${
                      picked ? "bg-[#334196] text-[#e5eaff]" : "bg-[#1a1f2a] text-[#c2cbe0] hover:bg-[#242b39]"
                    }`}
                  >
                    <span className="truncate">{candidate.name}</span>
                    <span className="ml-2 text-[10px] uppercase opacity-75">{candidate.type}</span>
                  </button>
                );
              })}
            </div>

            {selectedChannelMembers.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-1">
                {selectedChannelMembers.map((member) => (
                  <button
                    type="button"
                    key={`${member.type}:${member.id}`}
                    onClick={() => removeChannelMember(member)}
                    className="rounded-full bg-[#2f3850] px-2 py-1 text-[10px] text-[#dbe2fb]"
                  >
                    {member.name} x
                  </button>
                ))}
              </div>
            ) : null}

            <Button
              type="button"
              disabled={createLoading || !selectedServerId || !createName.trim()}
              onClick={handleCreateChannel}
              className="mt-3 w-full bg-[#5865f2] text-white hover:bg-[#4f5be3]"
            >
              {createLoading ? "Creating..." : "Create Channel"}
            </Button>
          </div>

          <div className="mt-3 rounded-xl border border-[#32384a] bg-[#121720] p-3">
            <p className="text-xs uppercase tracking-[0.1em] text-[#a5aec4]">Join Channel by ID</p>
            <input
              value={joinChannelId}
              onChange={(e) => setJoinChannelId(e.target.value)}
              placeholder="channel uuid"
              className="mt-2 w-full rounded-lg border border-[#384055] bg-[#0f141d] px-3 py-2 text-xs outline-none focus:border-[#7683ff]"
            />
            <Button
              type="button"
              variant="outline"
              onClick={handleJoinChannel}
              className="mt-2 w-full border-[#3a4257] bg-[#1a1f2a] text-[#d7deef] hover:bg-[#232a39]"
            >
              Join Channel
            </Button>
          </div>
        </aside>

        <section className="flex min-h-0 flex-1 flex-col bg-[#11151d]">
          <header className="flex items-center justify-between border-b border-[#2b2f3a] px-4 py-3">
            <div>
              <p className="text-xs uppercase tracking-[0.1em] text-[#8f98ad]">Current Context</p>
              <h1 className="text-lg font-semibold text-[#e7ecfb]">
                {selectedServer ? selectedServer.name : "No server"}
                {selectedChannel ? ` / #${selectedChannel.name}` : ""}
              </h1>
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
                {selectedChannel ? "No messages yet. Send the first message." : "Select a server and channel to start chatting."}
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

        <aside className="hidden w-[300px] border-l border-[#2b2f3a] bg-[#1a1f2a] p-4 lg:block">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-[#c8d0e4]">Channel Members</h2>
            {selectedChannel ? (
              <button
                type="button"
                onClick={() => loadMembers(selectedChannel.id).catch((err) => setUiError(err.message))}
                className="rounded-md bg-[#2a3040] px-2 py-1 text-xs text-[#d5dcf1] hover:bg-[#333b4f]"
              >
                Refresh
              </button>
            ) : null}
          </div>

          <div className="mt-3 space-y-2">
            {selectedChannel ? (
              members.length > 0 ? (
                members.map((member) => (
                  <article key={member.id} className="rounded-xl border border-[#32384a] bg-[#121720] px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <p className="text-sm text-[#e4eaff]">{member.member_name}</p>
                        <p className="text-xs text-[#9099b1]">
                          {member.member_type}
                          {member.member_subtitle ? ` · ${member.member_subtitle}` : ""}
                        </p>
                      </div>
                      {member.removable_by_actor ? (
                        <button
                          type="button"
                          onClick={() => handleRemoveMember(member)}
                          className="rounded-md bg-[#3b2431] px-2 py-1 text-xs text-[#ffbfd2] hover:bg-[#4f2d40]"
                        >
                          Remove
                        </button>
                      ) : null}
                    </div>
                  </article>
                ))
              ) : (
                <p className="text-sm text-[#8f98ad]">No members.</p>
              )
            ) : (
              <p className="text-sm text-[#8f98ad]">Select channel to view members.</p>
            )}
          </div>
        </aside>
      </div>
    </main>
  );
}
