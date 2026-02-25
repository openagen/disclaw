import { readSkillDoc } from "@/lib/skill-docs";

export const runtime = "nodejs";

export async function GET() {
  const content = await readSkillDoc("stateMachines");
  return new Response(content, {
    status: 200,
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Cache-Control": "public, max-age=60"
    }
  });
}
