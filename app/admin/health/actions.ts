"use server";

import { connection } from "next/server";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth/session";
import { paymentsMode } from "@/lib/payments/payments-mode";
import { createClient } from "@/lib/supabase/server";

/** The only app path that writes platform_settings.payments_mode. The value comes from the server environment, not the form. */
export async function activatePaymentsMode() {
  await connection();
  await requireAdmin("/admin/health");
  const mode = paymentsMode(process.env.PAYMENTS_MODE);
  const supabase = await createClient();
  const { error } = await supabase.rpc("activate_payments_mode", { next_mode: mode });
  if (error) {
    redirect("/admin/health?error=The database payment mode could not be updated.");
  }
  redirect("/admin/health?saved=payments-mode");
}
