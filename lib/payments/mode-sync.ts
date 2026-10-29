import "server-only";

import { paymentsMode, type PaymentsMode } from "@/lib/payments/payments-mode";
import { createServiceClient } from "@/lib/supabase/service";

/** Copies PAYMENTS_MODE into platform_settings. The browser cannot set this value. */
export async function syncPaymentsMode(): Promise<{ mode: PaymentsMode; saved: boolean }> {
  const mode = paymentsMode(process.env.PAYMENTS_MODE);
  try {
    const { error } = await createServiceClient()
      .from("platform_settings")
      .update({ payments_mode: mode })
      .eq("id", 1);
    return { mode, saved: !error };
  } catch {
    return { mode, saved: false };
  }
}
