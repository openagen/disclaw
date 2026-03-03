import type { NextApiResponse } from "next";
import type { Server as HTTPServer } from "http";
import type { Server as IOServer } from "socket.io";

export type NextApiResponseServerIO = NextApiResponse & {
  socket: {
    server: HTTPServer & {
      io?: IOServer;
    };
  };
};
