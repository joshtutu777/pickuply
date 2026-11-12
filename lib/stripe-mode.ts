export type StripeKeyMode = "test" | "live" | "missing";

/** A key is test, live, or missing. The payments switch decides which pair is allowed. */
export function stripeKeyMode(value: string | undefined): StripeKeyMode {
  if (!value) return "missing";
  if (value.startsWith("sk_test_") || value.startsWith("pk_test_")) return "test";
  if (value.startsWith("sk_live_") || value.startsWith("pk_live_")) return "live";
  return "missing";
}

/**
 * Test mode accepts a test pair. Live mode accepts a live pair only.
 * A test key and a live key together are refused in either mode.
 */
export function stripeModeProblem(
  secret: string | undefined,
  publishable: string | undefined,
  mode: "test" | "live" = "test",
): string | null {
  const secretMode = stripeKeyMode(secret);
  const publishableMode = stripeKeyMode(publishable);
  if (
    (secretMode === "live" && publishableMode === "test") ||
    (secretMode === "test" && publishableMode === "live")
  ) {
    return "Live and test Stripe keys cannot be mixed.";
  }
  if (mode === "live") {
    if (secretMode !== "live" || publishableMode !== "live") return "Live payments are not configured.";
    return null;
  }
  if (secretMode === "live" || publishableMode === "live") return "Live payments are not enabled.";
  if (secretMode !== "test") return "Stripe test mode is not configured.";
  if (publishableMode !== "test") return "The publishable key is not a test key.";
  return null;
}

export function stripeRefundAction(input: {
  metadataRefundId: string | null;
  status: string | null;
}): "pending" | "app" | "external" {
  if (!input.status || input.status === "pending") return "pending";
  if (input.metadataRefundId) return "app";
  return "external";
}
