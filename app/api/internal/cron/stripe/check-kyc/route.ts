import { fail, ok } from "@/lib/api";
import { requireCron } from "@/lib/admin-auth";
import { checkAndUpdateKycStatus } from "@/services/seller-service";

export async function POST(request: Request) {
  if (!requireCron(request.headers)) {
    return fail("UNAUTHORIZED", "Invalid cron token", 401);
  }

  const result = await checkAndUpdateKycStatus();

  return ok({
    success: true,
    checked: result.checked,
    updated: result.updated,
    recommended_interval_seconds: 60
  });
}
