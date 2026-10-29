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

export function webhookSecretName(kind: "payments" | "connect", mode: PaymentsMode): StripeEnvName {
  if (mode === "live") {
    return kind === "payments" ? "STRIPE_LIVE_WEBHOOK_SECRET" : "STRIPE_LIVE_CONNECT_WEBHOOK_SECRET";
  }
  return kind === "payments" ? "STRIPE_WEBHOOK_SECRET" : "STRIPE_CONNECT_WEBHOOK_SECRET";
}
