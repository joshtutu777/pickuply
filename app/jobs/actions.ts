"use server";

import { connection } from "next/server";
import { redirect } from "next/navigation";
import { captureReadyPayment, releaseCustomerAuthorization } from "@/lib/payments/capture";
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

function stepError(message: string | undefined): string {
  const text = message ?? "";
  const known = [
    "only the customer can approve the item",
    "the item is not ready for approval",
    "this job is on hold",
    "the pickup photo is not ready",
    "add a short reason",
    "only the customer can reject the item",
    "the item is not ready for a decision",
    "only the customer can confirm delivery",
    "this job is not delivered yet",
    "payment is on hold",
  ];
  return known.find((item) => text.includes(item)) ?? "That step is not available.";
}

export async function decidePickup(formData: FormData) {
  await connection();
  const jobId = String(formData.get("jobId") ?? "");
  const decision = String(formData.get("decision") ?? "");
  const reason = String(formData.get("reason") ?? "");
  const supabase = await createClient();
  const result =
    decision === "reject"
      ? await supabase.rpc("reject_pickup", { target_job: jobId, reason })
      : await supabase.rpc("approve_pickup", { target_job: jobId });
  if (result.error) {
    redirect(`/jobs/${jobId}?error=${encodeURIComponent(stepError(result.error.message))}`);
  }
  if (decision === "reject") {
    try {
      await captureReadyPayment(jobId);
    } catch {
      redirect(`/jobs/${jobId}?error=${encodeURIComponent("The item was rejected. The trip fee still needs to be captured.")}`);
    }
  }
  redirect(`/jobs/${jobId}`);
}

export async function confirmDelivery(formData: FormData) {
  await connection();
  const jobId = String(formData.get("jobId") ?? "");
  const supabase = await createClient();
  const result = await supabase.rpc("confirm_delivery", { target_job: jobId });
  if (result.error) {
    redirect(`/jobs/${jobId}?error=${encodeURIComponent(stepError(result.error.message))}`);
  }
  try {
    await captureReadyPayment(jobId);
  } catch {
    redirect(`/jobs/${jobId}?error=${encodeURIComponent("You confirmed delivery. The card charge is still being finished.")}`);
  }
  redirect(`/jobs/${jobId}`);
}

export async function cancelAssignedJob(formData: FormData) {
  await connection();
  const jobId = String(formData.get("jobId") ?? "");
  try {
    await releaseCustomerAuthorization(jobId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const known = [
      "only the customer can cancel this job",
      "this job can no longer be cancelled here",
      "this payment can no longer be cancelled here",
    ];
    const text = known.find((item) => message.includes(item)) ?? "This job could not be cancelled.";
    redirect(`/jobs/${jobId}?error=${encodeURIComponent(text)}`);
  }
  redirect(`/jobs/${jobId}`);
}
