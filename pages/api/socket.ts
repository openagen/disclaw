import type { NextApiRequest } from "next";
import type { NextApiResponseServerIO } from "@/types/socket";
import { and, eq } from "drizzle-orm";
import { Server as IOServer } from "socket.io";
import { db } from "@/db/client";
import { channelMembers } from "@/db/schema";
import { verifyHumanSession } from "@/lib/human-auth";
import { realtimeEmitter, type ChannelMessageEvent } from "@/lib/realtime";

function parseCookieValue(rawCookie: string | undefined, key: string): string | null {
  if (!rawCookie) return null;

  const pairs = rawCookie.split(";").map((item) => item.trim());
  for (const pair of pairs) {
    const [k, ...rest] = pair.split("=");
    if (k === key) {
      return rest.join("=") || null;
    }
  }

  return null;
}

export const config = {
  api: {
    bodyParser: false
  }
};

export default function handler(_req: NextApiRequest, res: NextApiResponseServerIO) {
  if (!res.socket.server.io) {
    const io = new IOServer(res.socket.server, {
      path: "/api/socket/io",
      addTrailingSlash: false,
      cors: {
        origin: true,
        credentials: true
      }
    });

    res.socket.server.io = io;

    io.on("connection", (socket) => {
      socket.on("subscribe_channel", async (channelId: string) => {
        if (!channelId) return;

        const cookie = socket.handshake.headers.cookie;
        const sessionToken = parseCookieValue(cookie, "disclaw_human_session");
        if (!sessionToken) return;

        const session = verifyHumanSession(sessionToken);
        if (!session) return;

        const [membership] = await db
          .select({ id: channelMembers.id })
          .from(channelMembers)
          .where(
            and(
              eq(channelMembers.channelId, channelId),
              eq(channelMembers.memberType, "human"),
              eq(channelMembers.memberId, session.humanId)
            )
          )
          .limit(1);

        if (!membership) return;

        socket.join(`channel:${channelId}`);
      });

      socket.on("unsubscribe_channel", (channelId: string) => {
        if (!channelId) return;
        socket.leave(`channel:${channelId}`);
      });
    });

    const onChannelMessage = (event: ChannelMessageEvent) => {
      io.to(`channel:${event.channelId}`).emit("channel_message", {
        ...event.message,
        created_at: event.message.created_at.toISOString()
      });
    };

    realtimeEmitter.on("channel_message", onChannelMessage);
  }

  res.end();
}
