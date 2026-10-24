"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function submitReview(formData: FormData) {
  const jobId = String(formData.get("jobId") ?? "");
  const nextPath = String(formData.get("next") ?? `/jobs/${jobId}`);
  const stars = Number(formData.get("stars"));
  const note = String(formData.get("note") ?? "");
  const supabase = await createClient();
  const { error } = await supabase.rpc("submit_job_review", {
    target_job: jobId,
    star_count: stars,
    note,
  });
  if (error) redirect(`${nextPath}?error=review`);
  redirect(`${nextPath}?saved=review`);
}

export async function hideReview(formData: FormData) {
  const reviewId = String(formData.get("reviewId") ?? "");
  const nextPath = String(formData.get("next") ?? "/admin/requests");
  const supabase = await createClient();
  const { error } = await supabase.rpc("hide_job_review", { target_review: reviewId });
  if (error) redirect(`${nextPath}?error=review`);
  redirect(`${nextPath}?saved=review`);
}
