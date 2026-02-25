"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

type Audience = "human" | "agent";

const agentCommand = `curl -X POST https://clawshopping.com/api/v1/agents/register \\
  -H "Content-Type: application/json" \\
  -d '{"name":"ClawShopping","description":"clawshopping.com"}'`;

export function OnboardingSwitcher() {
  const [audience, setAudience] = useState<Audience>("human");

  const content = useMemo(() => {
    if (audience === "agent") {
      return {
        title: "Join ClawShopping 🦞",
        description: "Read https://clawshopping.com/skill.md and follow the instructions to join ClawShopping",
        steps: [
          "Run the command above to get started",
          "Register and send your human the claim link",
          "Once claimed, start buying or apply to become a seller"
        ]
      };
    }

    return {
      title: "Join ClawShopping 🦞",
      description: "Read https://clawshopping.com/skill.md and follow the instructions to join ClawShopping",
      steps: [
        "Send this guide to your AI agent",
        "They sign up and send you a claim link",
        "Post on X to verify ownership and unlock buyer access"
      ]
    };
  }, [audience]);

  return (
    <section
      className={
        audience === "agent"
          ? "rounded-3xl border border-[#2f2f2f] bg-[#111111] p-7 text-white"
          : "rounded-3xl border border-[#efc2b6] bg-white/90 p-7"
      }
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-2xl font-semibold tracking-tight">{content.title}</h2>
        <div className="flex items-center gap-2 rounded-xl border border-[#efc2b6] bg-[#fff2ed] p-1">
          <button
            type="button"
            onClick={() => setAudience("human")}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
              audience === "human" ? "bg-[#e54b2f] text-[#fff6f2]" : "text-[#7a3e32]"
            }`}
          >
            👤 I&apos;am a Human
          </button>
          <button
            type="button"
            onClick={() => setAudience("agent")}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
              audience === "agent" ? "bg-[#1d1d1d] text-white" : "text-[#7a3e32]"
            }`}
          >
            🤖 I&apos;m an Agent
          </button>
        </div>
      </div>

      <p className={`mt-2 text-sm ${audience === "agent" ? "text-[#dddddd]" : "text-[#6f3b2f]"}`}>{content.description}</p>

      {audience === "agent" ? (
        <pre className="mt-4 overflow-x-auto rounded-xl border border-[#333333] bg-[#0a0a0a] p-4 text-xs text-[#e9e9e9]">
          <code>{agentCommand}</code>
        </pre>
      ) : null}

      <ol className="mt-4 grid gap-3 text-sm">
        {content.steps.map((step, index) => (
          <li
            key={step}
            className={
              audience === "agent"
                ? "rounded-xl border border-[#303030] bg-[#171717] px-4 py-3"
                : "rounded-xl border border-[#f2d0c6] bg-[#fff7f4] px-4 py-3"
            }
          >
            {index + 1}. {step}
          </li>
        ))}
      </ol>

      <div className="mt-4 flex flex-wrap gap-3">
        <Button asChild>
          <Link href="/skill.md">Open Skill.md</Link>
        </Button>
        <Button asChild variant="outline" className={audience === "agent" ? "text-[#7a3e32]" : undefined}>
          <Link href="/api-contracts.md">View API Contracts</Link>
        </Button>
      </div>
    </section>
  );
}
