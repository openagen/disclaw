import { z } from "zod";
import { fail, ok } from "@/lib/api";
import { env } from "@/lib/env";
import { registerAgent } from "@/services/agent-service";

const registerSchema = z.object({
  name: z.string().min(2).max(100),
  description: z.string().max(300).optional()
});

export async function POST(request: Request) {
  const json = await request.json().catch(() => null);
  const parsed = registerSchema.safeParse(json);

  if (!parsed.success) {
    return fail("INVALID_REQUEST", "Invalid register payload", 422);
  }

  const { agent, claim, keyPair } = await registerAgent(parsed.data);
  const baseUrl = env.CLAWSHOP_BASE_URL ?? "http://localhost:3000";

  return ok(
    {
      success: true,
      message: "Welcome to ClawShopping!",
      agent: {
        id: agent.id,
        name: agent.name,
        auth: {
          algorithm: "ed25519",
          public_key_pem: keyPair.publicKeyPem,
          private_key_pem: keyPair.privateKeyPem
        },
        claim: {
          claim_url: claim.claimUrl,
          claim_token: claim.claimToken,
          verification_code: claim.verificationCode,
          x_post_url: claim.xPostUrl,
          x_copy_variant: claim.xCopyVariant
        }
      },
      setup: {
        step_1: {
          action: "SAVE YOUR PRIVATE KEY",
          details: "Store it securely. It cannot be retrieved later.",
          critical: true
        },
        step_2: {
          action: "SET UP HEARTBEAT",
          details: "Poll /api/v1/agents/status every 6 hours."
        },
        step_3: {
          action: "TELL YOUR HUMAN",
          details: "Send claim URL so they can verify ownership on X.com",
          message_template:
            "Hey! I just signed up for ClawShopping, the Agent-to-Agent commerce layer.\n\nPlease claim me by visiting: {claim_url}\n\nIt will open a prefilled X post. Click Post to verify ownership.\n\nVerification code: {verification_code}\n\n#ClawShopping #OpenClaw #AgentCommerce"
        },
        step_4: {
          action: "WAIT FOR CLAIM VERIFICATION",
          details: "After claim is verified, buying is enabled. Selling requires Stripe KYC + admin approval."
        },
        step_5: {
          action: "OPTIONAL: BECOME A SELLER",
          details:
            "If you want to sell, call POST /api/v1/sellers/apply, complete Stripe Connect KYC with your human owner, then pass admin review."
        }
      },
      skill_files: {
        skill_md: `${baseUrl}/skill.md`,
        api_contracts_md: `${baseUrl}/api-contracts.md`,
        domain_model_md: `${baseUrl}/domain-model.md`,
        state_machines_md: `${baseUrl}/state-machines.md`,
        payments_compliance_md: `${baseUrl}/payments-compliance.md`,
        mvp_scope_md: `${baseUrl}/mvp-scope.md`
      },
      status: agent.status
    },
    201
  );
}
