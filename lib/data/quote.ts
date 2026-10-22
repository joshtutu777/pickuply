import "server-only";

import { createClient } from "@/lib/supabase/server";

export type QuoteNotice = {
  adminNote: string | null;
  quote: {
    driverPayCents: number;
    platformFeeCents: number;
    serviceFeeCents: number;
    totalCents: number;
    expiresAt: string;
  } | null;
};

/** Extra pricing columns from 0008. Returns null when those columns are not available. */
export async function getQuoteNotice(jobId: string): Promise<QuoteNotice | null> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("jobs")
      .select(
        "status, price_cents, driver_pay_cents, platform_fee_cents, service_fee_cents, quote_expires_at, admin_note",
      )
      .eq("id", jobId)
      .maybeSingle();
    if (error || !data) return null;
    const ready =
      data.status === "quoted" &&
      data.price_cents != null &&
      data.driver_pay_cents != null &&
      data.platform_fee_cents != null &&
      data.service_fee_cents != null &&
      data.quote_expires_at != null;
    return {
      adminNote: data.admin_note,
      quote: ready
        ? {
            driverPayCents: data.driver_pay_cents,
            platformFeeCents: data.platform_fee_cents,
            serviceFeeCents: data.service_fee_cents,
            totalCents: data.price_cents,
            expiresAt: data.quote_expires_at,
          }
        : null,
    };
  } catch {
    return null;
  }
}
