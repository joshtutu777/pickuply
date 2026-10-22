"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export async function resolveDispute(formData: FormData) {
  await requireAdmin("/admin");
  const jobId = String(formData.get("jobId") ?? "");
  const amount = String(formData.get("amount") ?? "").trim();
  const supabase = await createClient();
  const { error } = await supabase.rpc("resolve_dispute", {
    target_job: jobId,
    outcome: String(formData.get("outcome") ?? ""),
    notes: String(formData.get("notes") ?? ""),
    amount_cents: amount ? Math.round(Number(amount) * 100) : null,
    reason: String(formData.get("reason") ?? ""),
    release_capture: formData.get("releaseCapture") === "on",
    release_payout: formData.get("releasePayout") === "on",
  });
  revalidatePath(`/admin/requests/${jobId}`);
  redirect(error ? `/admin/requests/${jobId}?error=Could%20not%20save%20the%20resolution` : `/admin/requests/${jobId}?saved=dispute`);
}
