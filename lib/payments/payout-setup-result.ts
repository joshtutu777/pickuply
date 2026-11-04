export type PayoutSetupStage = "driver_lookup" | "stripe_account_create" | "account_save" | "stripe_account_link";

const reportedFailures = new WeakSet<object>();

/** Driver-facing text for a failed payout setup. Stripe's own wording stays in the server log. */
export function payoutSetupErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  const clean = message.replace(/\s+/g, " ").trim();
  if (/paused/i.test(clean)) return "Payments are paused. Try again in a few minutes.";
  if (/could not be saved/i.test(clean)) return "The payout account could not be saved. Try again in a moment.";
  if (/does not match the current payment mode/i.test(clean)) {
    return "This payout account does not match the current payment mode.";
  }
  if (/not configured/i.test(clean)) return "Payout setup is not available right now. Please contact Pickuply.";
  if (/did not return a setup link/i.test(clean) || /did not open payout setup/i.test(clean)) {
    return "Stripe did not open payout setup. Try again in a moment.";
  }
  if (/belongs to someone else/i.test(clean)) return "This payout account belongs to someone else.";
  return "Payout setup could not be started. Try again in a moment.";
}

/** One server log line naming the failing stage. Secrets, account ids, and contact details are removed. */
export function reportPayoutSetupFailure(stage: PayoutSetupStage, error: unknown): void {
  if (typeof error === "object" && error !== null) {
    if (reportedFailures.has(error)) return;
    reportedFailures.add(error);
  }
  const details = stripeErrorDetails(error);
  console.error(
    JSON.stringify({
      event: "payout_setup_failed",
      stage,
      error_name: details.name,
      error_type: details.type,
      error_code: details.code,
      status: details.status,
      error_message: redactPayoutSetupMessage(error instanceof Error ? error.message : ""),
    }),
  );
}

export function stripeErrorDetails(error: unknown): {
  name: string;
  type: string | null;
  code: string | null;
  status: number | null;
} {
  const record = error && typeof error === "object" ? (error as Record<string, unknown>) : {};
  const raw = record.raw && typeof record.raw === "object" ? (record.raw as Record<string, unknown>) : {};
  const status = typeof record.statusCode === "number" ? record.statusCode : null;
  return {
    name: (error instanceof Error ? error.name : "Unknown").slice(0, 80),
    type: textField(raw.type) ?? textField(record.type),
    code: textField(raw.code) ?? textField(record.code),
    status,
  };
}

export function redactPayoutSetupMessage(message: string): string {
  return message
    .replace(/sk_(live|test)_[A-Za-z0-9]+/g, "[key]")
    .replace(/whsec_[A-Za-z0-9]+/g, "[secret]")
    .replace(/acct_[A-Za-z0-9]+/g, "acct_[id]")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "[id]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(/\+?\d[\d\s().-]{8,}\d/g, "[phone]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
}

function textField(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value.slice(0, 80) : null;
}

/** Only Stripe's hosted onboarding host may take the driver out of Pickuply. */
export function stripeOnboardingUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return null;
    if (url.hostname !== "connect.stripe.com") return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function isNextRedirect(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("digest" in error)) return false;
  return String((error as { digest?: unknown }).digest).startsWith("NEXT_REDIRECT");
}
