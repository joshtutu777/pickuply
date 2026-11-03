"use server";

import { revalidatePath } from "next/cache";
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
  if (error && !(await sameOfferAlreadyAssigned(supabase, jobId, offerId))) {
    redirect(`/jobs/${jobId}?error=${encodeURIComponent(error.message)}`);
  }
  revalidatePath(`/jobs/${jobId}`);
  redirect(`/jobs/${jobId}?chosen=1`);
}

/** A slow or repeated click must follow the saved assignment and must not start another one. */
async function sameOfferAlreadyAssigned(
  supabase: Awaited<ReturnType<typeof createClient>>,
  jobId: string,
  offerId: string,
) {
  const { data } = await supabase
    .from("jobs")
    .select("status, accepted_offer_id")
    .eq("id", jobId)
    .maybeSingle();
  return data?.status === "assigned" && data.accepted_offer_id === offerId;
}
