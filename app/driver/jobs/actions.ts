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
  if (nextStatus === "item_check") {
    const { count } = await supabase
      .from("job_photos")
      .select("id", { count: "exact", head: true })
      .eq("job_id", jobId)
      .eq("stage", "pickup")
      .is("report_id", null);
    if (!count) redirect(`/driver/jobs/${jobId}?error=photo`);
  }
  const { error } = await supabase.rpc("advance_job", {
    target_job: jobId,
    next_status: nextStatus,
  });
  revalidatePath(`/driver/jobs/${jobId}`);
  revalidatePath(`/jobs/${jobId}`);
  redirect(error ? `/driver/jobs/${jobId}?error=step` : `/driver/jobs/${jobId}`);
}
