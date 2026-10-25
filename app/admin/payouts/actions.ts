"use server";

import { connection } from "next/server";
import { redirect } from "next/navigation";
import { reverseTransferForRecovery } from "@/lib/payments/refunds";
import { createClient } from "@/lib/supabase/server";

function back(error: string): never {
  redirect(`/admin/payouts?error=${encodeURIComponent(error)}`);
}

export async function recordOutsidePayment(formData: FormData) {
  await connection();
  const supabase = await createClient();
  const { error } = await supabase.rpc("record_external_payment", {
    target_entry: String(formData.get("entryId") ?? ""),
    method: String(formData.get("method") ?? ""),
    reference: String(formData.get("reference") ?? ""),
    reason: String(formData.get("reason") ?? ""),
  });
  if (error) back("The outside payment could not be recorded.");
  redirect("/admin/payouts");
}

export async function recoverReversal(formData: FormData) {
  await connection();
  const obligationId = String(formData.get("obligationId") ?? "");
  const reason = String(formData.get("reason") ?? "");
  const supabase = await createClient();
  const { data } = await supabase
    .from("recovery_obligations")
    .select("ledger_id")
    .eq("id", obligationId)
    .maybeSingle();
  if (!data) back("That recovery was not found.");
  const entry = await supabase.from("ledger_entries").select("stripe_transfer_id").eq("id", data.ledger_id).maybeSingle();
  if (!entry.data?.stripe_transfer_id) back("There is no transfer to reverse.");
  try {
    await reverseTransferForRecovery(obligationId, entry.data.stripe_transfer_id, reason);
  } catch {
    back("The transfer could not be reversed.");
  }
  redirect("/admin/payouts");
}

export async function recoverDeduction(formData: FormData) {
  await connection();
  const supabase = await createClient();
  const { error } = await supabase.rpc("apply_recovery_deduction", {
    target_obligation: String(formData.get("obligationId") ?? ""),
    target_entry: String(formData.get("entryId") ?? ""),
    reason: String(formData.get("reason") ?? ""),
  });
  if (error) back("That earning could not cover the recovery.");
  redirect("/admin/payouts");
}
