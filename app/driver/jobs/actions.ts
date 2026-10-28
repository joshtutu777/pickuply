"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getOptionalSession, requireSignedIn } from "@/lib/auth/session";
import { advanceErrorCode } from "@/lib/jobs/delivery-step";
import { createClient } from "@/lib/supabase/server";

export async function advanceJob(formData: FormData) {
  const session = await requireSignedIn("/driver");
  if (session.role !== "driver") redirect("/account");
  const jobId = String(formData.get("jobId") ?? "");
  const nextStatus = String(formData.get("nextStatus") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(jobId)) redirect("/driver");
  const supabase = await createClient();
  const { error } = await supabase.rpc("advance_job", {
    target_job: jobId,
    next_status: nextStatus,
  });
  revalidatePath(`/driver/jobs/${jobId}`);
  revalidatePath(`/jobs/${jobId}`);
  redirect(error ? `/driver/jobs/${jobId}?error=${advanceErrorCode(error.message)}` : `/driver/jobs/${jobId}`);
}

export async function closePickupReview(formData: FormData) {
  const session = await getOptionalSession();
  if (!session) return;
  const jobId = String(formData.get("jobId") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(jobId)) return;
  const supabase = await createClient();
  await supabase.rpc("close_pickup_review", { target_job: jobId });
  revalidatePath(`/driver/jobs/${jobId}`);
  revalidatePath(`/jobs/${jobId}`);
}

export async function reportCustomerNoShow(formData: FormData) {
  await requireSignedIn("/driver");
  const jobId = String(formData.get("jobId") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(jobId)) redirect("/driver");
  const supabase = await createClient();
  const { error } = await supabase.rpc("mark_customer_no_show", { target_job: jobId });
  revalidatePath(`/driver/jobs/${jobId}`);
  redirect(error ? `/driver/jobs/${jobId}?error=noshow` : `/driver/jobs/${jobId}`);
}
