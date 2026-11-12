import { webhookSecretName, type PaymentsMode } from "@/lib/payments/payments-mode";

/** Test first, then live. A missing or non-signing value is not a candidate. */
export function webhookSecretCandidates(
  kind: "payments" | "connect",
  env: Record<string, string | undefined>,
): Array<{ mode: PaymentsMode; secret: string }> {
  const found: Array<{ mode: PaymentsMode; secret: string }> = [];
  for (const mode of ["test", "live"] as const) {
    const secret = env[webhookSecretName(kind, mode)] ?? "";
    if (secret.startsWith("whsec_")) found.push({ mode, secret });
  }
  return found;
}

/** The secret that verified the event has to belong to that event's Stripe mode. */
export function webhookSecretAgrees(mode: PaymentsMode, eventLivemode: boolean): boolean {
  return mode === "live" ? eventLivemode : !eventLivemode;
}
