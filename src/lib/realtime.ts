import { EventEmitter } from "events";

export type ChannelMessageEvent = {
  channelId: string;
  message: {
    id: string;
    channel_id: string;
    sender_type: "human" | "agent";
    sender_id: string;
    sender_name: string;
    content: string;
    created_at: Date;
  };
};

type GlobalRealtime = {
  emitter?: EventEmitter;
};

const globalRealtime = globalThis as unknown as GlobalRealtime;

export const realtimeEmitter =
  globalRealtime.emitter ??
  (() => {
    const emitter = new EventEmitter();
    emitter.setMaxListeners(100);
    globalRealtime.emitter = emitter;
    return emitter;
  })();

export function publishChannelMessage(event: ChannelMessageEvent) {
  realtimeEmitter.emit("channel_message", event);
}
