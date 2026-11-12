"use server";

import { connection } from "next/server";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function updatePickupTiming(formData: FormData) {
  await connection();
  const jobId = String(formData.get("jobId") ?? "");
  const timing = String(formData.get("timing") ?? "");
  const supabase = await createClient();
  const { error } = await supabase.rpc("update_open_pickup_timing", {
    target_job: jobId,
    next_availability: timing,
  });
  if (error) redirect(`/jobs/${jobId}?error=${encodeURIComponent(error.message)}`);
  redirect(`/jobs/${jobId}?saved=timing`);
}

export async function chooseOffer(formData: FormData) {
  await connection();
  const jobId = String(formData.get("jobId") ?? "");
  const offerId = String(formData.get("offerId") ?? "");
  const supabase = await createClient();
  const { error } = await supabase.rpc("choose_offer", { target_offer: offerId });
  if (error) redirect(`/jobs/${jobId}?error=${encodeURIComponent(error.message)}`);
  redirect(`/jobs/${jobId}?tracked=offer`);
}
