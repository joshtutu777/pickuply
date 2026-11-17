export type PaymentsMode = "test" | "live";

/** Anything other than the exact value live stays in test mode. */
export function paymentsMode(value: string | undefined): PaymentsMode {
  return value === "live" ? "live" : "test";
}

export function currentStripeLivemode(value: string | undefined = process.env.PAYMENTS_MODE): boolean {
  return paymentsMode(value) === "live";
}

export type StripeEnvName =
  | "STRIPE_SECRET_KEY"
  | "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY"
  | "STRIPE_WEBHOOK_SECRET"
  | "STRIPE_CONNECT_WEBHOOK_SECRET"
  | "STRIPE_LIVE_SECRET_KEY"
  | "NEXT_PUBLIC_STRIPE_LIVE_PUBLISHABLE_KEY"
  | "STRIPE_LIVE_WEBHOOK_SECRET"
  | "STRIPE_LIVE_CONNECT_WEBHOOK_SECRET"
  | "STRIPE_TEST_SECRET_KEY";

export type StripeSelection = {
  secret: string | undefined;
  publishable: string | undefined;
  paymentsWebhook: string | undefined;
  connectWebhook: string | undefined;
};

/** Live names are read only when the switch is live. Test mode never reads them. */
export function stripeEnvForMode(mode: PaymentsMode, env: Record<string, string | undefined>): StripeSelection {
  if (mode === "live") {
    return {
      secret: env.STRIPE_LIVE_SECRET_KEY,
      publishable: env.NEXT_PUBLIC_STRIPE_LIVE_PUBLISHABLE_KEY,
      paymentsWebhook: env.STRIPE_LIVE_WEBHOOK_SECRET,
      connectWebhook: env.STRIPE_LIVE_CONNECT_WEBHOOK_SECRET,
    };
  }
  return {
    secret: env.STRIPE_SECRET_KEY,
    publishable: env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,
    paymentsWebhook: env.STRIPE_WEBHOOK_SECRET,
    connectWebhook: env.STRIPE_CONNECT_WEBHOOK_SECRET,
  };
}

export type RecordedSecretName = "STRIPE_TEST_SECRET_KEY" | "STRIPE_SECRET_KEY" | "STRIPE_LIVE_SECRET_KEY";

/**
 * An existing payment row picks its own secret. This does not read PAYMENTS_MODE.
 * A live row uses only STRIPE_LIVE_SECRET_KEY. A test row keeps STRIPE_SECRET_KEY
 * when that value is still a test key, because that is the key that created it.
 */
export function recordedPaymentSecret(
  livemode: boolean,
  env: Record<string, string | undefined>,
): { name: RecordedSecretName; value: string } {
  if (livemode) {
    const live = env.STRIPE_LIVE_SECRET_KEY ?? "";
    if (!live.startsWith("sk_live_")) throw new Error("Live payments are not configured.");
    return { name: "STRIPE_LIVE_SECRET_KEY", value: live };
  }
  const current = env.STRIPE_SECRET_KEY ?? "";
  if (current.startsWith("sk_test_")) return { name: "STRIPE_SECRET_KEY", value: current };
  const dedicated = env.STRIPE_TEST_SECRET_KEY ?? "";
  if (dedicated.startsWith("sk_test_")) return { name: "STRIPE_TEST_SECRET_KEY", value: dedicated };
  throw new Error("Stripe test mode is not configured.");
}

export function webhookSecretName(kind: "payments" | "connect", mode: PaymentsMode): StripeEnvName {
  if (mode === "live") {
    return kind === "payments" ? "STRIPE_LIVE_WEBHOOK_SECRET" : "STRIPE_LIVE_CONNECT_WEBHOOK_SECRET";
  }
  return kind === "payments" ? "STRIPE_WEBHOOK_SECRET" : "STRIPE_CONNECT_WEBHOOK_SECRET";
}
