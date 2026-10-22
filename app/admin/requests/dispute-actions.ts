"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requestRefund } from "@/lib/payments/refunds";
import { requireAdmin } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export async function resolveDispute(formData: FormData) {
  await requireAdmin("/admin");
  const jobId = String(formData.get("jobId") ?? "");
  const outcome = String(formData.get("outcome") ?? "");
  const amount = String(formData.get("amount") ?? "").trim();
  const cents = amount ? Math.round(Number(amount) * 100) : null;
  const reason = String(formData.get("reason") ?? "");
  const supabase = await createClient();
  if ((outcome === "partial_refund" || outcome === "full_refund") && cents && cents > 0) {
    const existing = await supabase
      .from("refund_requests")
      .select("id")
      .eq("job_id", jobId)
      .eq("status", "succeeded")
      .eq("amount_cents", cents)
      .maybeSingle();
    if (!existing.data) {
      try {
        await requestRefund(jobId, cents, reason);
      } catch {
        redirect(`/admin/requests/${jobId}?error=Could%20not%20refund%20the%20card`);
      }
    }
  }
  const { error } = await supabase.rpc("resolve_dispute", {
    target_job: jobId,
    outcome,
    notes: String(formData.get("notes") ?? ""),
    amount_cents: cents,
    reason,
    release_capture: formData.get("releaseCapture") === "on",
    release_payout: formData.get("releasePayout") === "on",
  });
  revalidatePath(`/admin/requests/${jobId}`);
  redirect(error ? `/admin/requests/${jobId}?error=Could%20not%20save%20the%20resolution` : `/admin/requests/${jobId}?saved=dispute`);
}
