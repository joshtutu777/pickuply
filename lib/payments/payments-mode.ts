import { stripeKeyMode } from "@/lib/stripe-mode";

export type PaymentsMode = "test" | "live";

/** Anything other than the exact value live stays in test mode. */
export function paymentsMode(value: string | undefined): PaymentsMode {
  return value === "live" ? "live" : "test";
}

/** The boolean passed to ready_transfers. Live mode selects live charges only. */
export function transferLivemode(mode: PaymentsMode): boolean {
  return mode === "live";
}

/** A real driver must have payouts and transfers before accepting work in live mode. */
export function driverNeedsLivePayouts(mode: PaymentsMode, isTestDriver: boolean): boolean {
  return mode === "live" && !isTestDriver;
}

export type StripeEnvName =
  | "STRIPE_SECRET_KEY"
  | "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY"
  | "STRIPE_WEBHOOK_SECRET"
  | "STRIPE_CONNECT_WEBHOOK_SECRET"
  | "STRIPE_LIVE_SECRET_KEY"
  | "NEXT_PUBLIC_STRIPE_LIVE_PUBLISHABLE_KEY"
  | "STRIPE_LIVE_WEBHOOK_SECRET"
  | "STRIPE_LIVE_CONNECT_WEBHOOK_SECRET";

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
 * An existing payment row picks its own secret.
 * Test rows read STRIPE_TEST_SECRET_KEY. Live rows read a live secret and never a test secret.
 * This does not read PAYMENTS_MODE and does not change any saved key.
 */
export function recordedPaymentSecret(
  livemode: boolean,
  env: Record<string, string | undefined>,
): { name: RecordedSecretName; value: string } {
  if (!livemode) {
    const value = env.STRIPE_TEST_SECRET_KEY;
    if (!value || stripeKeyMode(value) !== "test") throw new Error("Stripe test mode is not configured.");
    return { name: "STRIPE_TEST_SECRET_KEY", value };
  }
  const namedLive = env.STRIPE_SECRET_KEY;
  if (namedLive && stripeKeyMode(namedLive) === "live") {
    return { name: "STRIPE_SECRET_KEY", value: namedLive };
  }
  const dedicatedLive = env.STRIPE_LIVE_SECRET_KEY;
  if (dedicatedLive && stripeKeyMode(dedicatedLive) === "live") {
    return { name: "STRIPE_LIVE_SECRET_KEY", value: dedicatedLive };
  }
  throw new Error("Live payments are not configured.");
}

export function webhookSecretName(kind: "payments" | "connect", mode: PaymentsMode): StripeEnvName {
  if (mode === "live") {
    return kind === "payments" ? "STRIPE_LIVE_WEBHOOK_SECRET" : "STRIPE_LIVE_CONNECT_WEBHOOK_SECRET";
  }
  return kind === "payments" ? "STRIPE_WEBHOOK_SECRET" : "STRIPE_CONNECT_WEBHOOK_SECRET";
}
