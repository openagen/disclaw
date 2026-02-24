export default function SellerOnboardingReturnPage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col items-start justify-center gap-5 px-6 py-16">
      <p className="text-sm font-semibold uppercase tracking-wide text-[#4f5b42]">ClawShopping Seller Onboarding</p>
      <h1 className="text-3xl font-bold tracking-tight">You have returned from Stripe.</h1>
      <p className="text-base text-[#42513a]">
        Your browser step is complete. We are now waiting for Stripe webhook events to update your seller status.
      </p>
      <div className="rounded-lg border bg-white/80 p-4 text-sm text-[#42513a]">
        <p>Next checks:</p>
        <p>1. Ensure <code>stripe listen --forward-to localhost:3000/api/v1/webhooks/stripe</code> is running.</p>
        <p>2. Confirm your <code>STRIPE_WEBHOOK_SECRET</code> matches the current listen session.</p>
        <p>3. Verify seller status via <code>/api/v1/agents/status</code>.</p>
      </div>
    </main>
  );
}
