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
 * Copies PAYMENTS_MODE into platform_settings when the row still has the previous value.
 * A failed write blocks new payment work. The browser cannot set this value.
 */
export async function alignPaymentsMode(): Promise<AlignedPaymentsMode> {
  const mode = paymentsMode(process.env.PAYMENTS_MODE);
  const supabase = createServiceClient();
  try {
    const current = await supabase.from("platform_settings").select("payments_mode").eq("id", 1).maybeSingle();
    if (current.error) return blocked(mode, null);
    const database = current.data?.payments_mode ?? null;
    if (paymentsModesMatch(mode, database)) {
      return { mode, database: database as StoredPaymentsMode, matches: true, saved: true };
    }
    const updated = await supabase
      .from("platform_settings")
      .update({ payments_mode: mode })
      .eq("id", 1)
      .eq("payments_mode", database)
      .select("payments_mode")
      .maybeSingle();
    if (updated.error || !paymentsModesMatch(mode, updated.data?.payments_mode)) {
      const again = await supabase.from("platform_settings").select("payments_mode").eq("id", 1).maybeSingle();
      if (!again.error && paymentsModesMatch(mode, again.data?.payments_mode)) {
        return { mode, database: mode, matches: true, saved: true };
      }
      await alertPaymentsIssue(
        `payments-mode-mismatch:${mode}:${database ?? "missing"}`,
        "Payment mode mismatch",
        "The payment switch and the database do not match. New payments and transfers are paused. The Stripe object was not changed.",
      );
      return blocked(mode, again.data?.payments_mode ?? database);
    }
    await supabase.from("audit_log").insert({
      actor_id: null,
      action: "payments_mode_aligned",
      target_type: "platform_settings",
      target_id: null,
      data: { from: database, to: mode },
    });
    return { mode, database: mode, matches: true, saved: true };
  } catch {
    return blocked(mode, null);
  }
}

function blocked(mode: PaymentsMode, database: string | null | undefined): AlignedPaymentsMode {
  const label = modeAlignmentLabel(mode, database);
  return { mode, database: label.database, matches: false, saved: false };
}

/** @deprecated Use alignPaymentsMode. Kept so older imports still compile during review. */
export async function syncPaymentsMode(): Promise<{ mode: PaymentsMode; saved: boolean }> {
  const aligned = await alignPaymentsMode();
  return { mode: aligned.mode, saved: aligned.saved };
}
