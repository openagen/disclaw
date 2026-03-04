import { ok } from "@/lib/api";

export async function POST() {
  const response = ok({ success: true, message: "Logged out" });
  response.cookies.set("shareclaw_human_session", "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
    expires: new Date(0)
  });
  return response;
}
