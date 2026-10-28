export type StripeKeyMode = "test" | "live" | "missing";

/** Live mode stays closed. A later release can open it only with an explicit owner approval. */
export function stripeKeyMode(value: string | undefined): StripeKeyMode {
  if (!value) return "missing";
  if (value.startsWith("sk_test_") || value.startsWith("pk_test_")) return "test";
  if (value.startsWith("sk_live_") || value.startsWith("pk_live_")) return "live";
  return "missing";
}

/**
 * The server accepts a test secret only when the publishable key is also test.
 * A live secret is refused even if a future environment sets one.
 */
export function stripeModeProblem(secret: string | undefined, publishable: string | undefined): string | null {
  const secretMode = stripeKeyMode(secret);
  const publishableMode = stripeKeyMode(publishable);
  if (secretMode === "live" || publishableMode === "live") {
    return "Live payments are not enabled.";
  }
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
