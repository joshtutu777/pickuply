"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSignedIn } from "@/lib/auth/session";
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
  redirect(error ? `/driver/jobs/${jobId}?error=step` : `/driver/jobs/${jobId}`);
}
