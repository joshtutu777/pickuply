"use server";

import { connection } from "next/server";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function respondToQuote(formData: FormData) {
  await connection();
  const jobId = String(formData.get("jobId") ?? "");
  const decision = String(formData.get("decision") ?? "");
  const supabase = await createClient();
  const { error } =
    decision === "decline"
      ? await supabase.rpc("decline_admin_quote", { target_job: jobId })
      : await supabase.rpc("accept_admin_quote", { target_job: jobId });
  if (error) {
    redirect(`/jobs/${jobId}?error=${encodeURIComponent(error.message)}`);
  }
  redirect(`/jobs/${jobId}`);
}
