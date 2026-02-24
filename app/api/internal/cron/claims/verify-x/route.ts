import { fail, ok } from "@/lib/api";
import { requireCron } from "@/lib/admin-auth";
import { env } from "@/lib/env";
import { listPendingXClaims, markClaimVerified, markExpiredClaims } from "@/services/claim-service";
import { verifySingleClaimByX } from "@/services/x-verifier-service";

export async function POST(request: Request) {
  if (!requireCron(request.headers)) {
    return fail("UNAUTHORIZED", "Invalid cron token", 401);
  }

  await markExpiredClaims();
  const claims = await listPendingXClaims(100);
  let verified = 0;
  let checked = 0;
  const debug = new URL(request.url).searchParams.get("debug") === "1";
  const details: Array<{
    claim_token: string;
    code: string;
    x_handle: string | null;
    matched: boolean;
    reason: string | null;
  }> = [];
  for (const claim of claims) {
    checked += 1;
    const result = await verifySingleClaimByX({
      xHandle: claim.xHandle,
      verificationCode: claim.verificationCode,
      windowMinutes: env.X_CLAIM_POLL_WINDOW_MINUTES
    });

    if (result.matched) {
      await markClaimVerified(claim.id);
      verified += 1;
    }

    if (debug) {
      details.push({
        claim_token: claim.claimToken,
        code: claim.verificationCode,
        x_handle: claim.xHandle,
        matched: result.matched,
        reason: result.reason
      });
    }
  }

  return ok({
    success: true,
    checked,
    verified,
    recommended_interval_seconds: 60,
    ...(debug ? { details } : {})
  });
}
