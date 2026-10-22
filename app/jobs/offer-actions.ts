"use server";

import { connection } from "next/server";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function chooseOffer(formData: FormData) {
  await connection();
  const jobId = String(formData.get("jobId") ?? "");
  const offerId = String(formData.get("offerId") ?? "");
  const supabase = await createClient();
  const { error } = await supabase.rpc("choose_offer", { target_offer: offerId });
  if (error) redirect(`/jobs/${jobId}?error=${encodeURIComponent(error.message)}`);
  redirect(`/jobs/${jobId}`);
}
