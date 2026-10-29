import "server-only";

import { modeAlignmentLabel, paymentsModesMatch, type StoredPaymentsMode } from "@/lib/payments/mode-alignment";
import { alertPaymentsIssue } from "@/lib/payments/mode-alert";
import { paymentsMode, type PaymentsMode } from "@/lib/payments/payments-mode";
import { createServiceClient } from "@/lib/supabase/service";

export type AlignedPaymentsMode = {
  mode: PaymentsMode;
  database: StoredPaymentsMode | "missing";
  matches: boolean;
  saved: boolean;
};

/**
 * Reads the environment switch and the database row. It does not change the database.
 * Checkout, driver acceptance, transfers, and Health all use this read.
 */
export async function readPaymentsMode(): Promise<AlignedPaymentsMode> {
  const mode = paymentsMode(process.env.PAYMENTS_MODE);
  try {
    const current = await createServiceClient().from("platform_settings").select("payments_mode").eq("id", 1).maybeSingle();
    if (current.error) return blocked(mode, null);
    const database = current.data?.payments_mode ?? null;
    if (paymentsModesMatch(mode, database)) {
      return { mode, database: database as StoredPaymentsMode, matches: true, saved: true };
    }
    return blocked(mode, database);
  } catch {
    return blocked(mode, null);
  }
}

/** Fail closed. A mismatch alerts an admin and does not change Stripe or the database. */
export async function confirmPaymentsMode(): Promise<AlignedPaymentsMode> {
  const current = await readPaymentsMode();
  if (!current.matches) {
    await alertPaymentsIssue(
      `payments-mode-mismatch:${current.mode}:${current.database}`,
      "Payment mode mismatch",
      "The payment switch and the database do not match. New payments and transfers are paused. An admin sets the database from Health. The Stripe object was not changed.",
    );
  }
  return current;
}

function blocked(mode: PaymentsMode, database: string | null | undefined): AlignedPaymentsMode {
  const label = modeAlignmentLabel(mode, database);
  return { mode, database: label.database, matches: false, saved: false };
}

/** @deprecated Use confirmPaymentsMode. This no longer writes the database. */
export async function alignPaymentsMode(): Promise<AlignedPaymentsMode> {
  return confirmPaymentsMode();
}

/** @deprecated Use confirmPaymentsMode. This no longer writes the database. */
export async function syncPaymentsMode(): Promise<{ mode: PaymentsMode; saved: boolean }> {
  const current = await confirmPaymentsMode();
  return { mode: current.mode, saved: current.saved };
}
