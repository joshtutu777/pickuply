import "server-only";

import { livemodeNoteDecision } from "@/lib/payments/livemode-note";
import { alertPaymentsIssue } from "@/lib/payments/mode-alert";
import { createServiceClient } from "@/lib/supabase/service";

export async function readSavedLivemode(jobId: string): Promise<boolean | null> {
  const payment = await createServiceClient()
    .from("job_payments")
    .select("stripe_livemode")
    .eq("job_id", jobId)
    .maybeSingle();
  if (payment.error) throw new Error("The payment mode could not be checked.");
  return typeof payment.data?.stripe_livemode === "boolean" ? payment.data.stripe_livemode : null;
}

/**
 * Writes a Stripe mode only when the payment does not have one yet.
 * The same mode is left untouched. The opposite mode is not sent to the database.
 */
export async function recordLivemodeIfUnset(jobId: string, live: boolean): Promise<"recorded" | "retried" | "rejected"> {
  const decision = livemodeNoteDecision(await readSavedLivemode(jobId), live);
  if (decision === "reject") {
    await alertPaymentsIssue(
      `livemode-conflict:${jobId}`,
      "Payment mode conflict",
      "A Stripe event did not match the mode already saved for this booking. The saved mode was left unchanged.",
    );
    return "rejected";
  }
  if (decision === "retry") return "retried";
  const marked = await createServiceClient().rpc("note_stripe_livemode", { target_job: jobId, live });
  if (marked.error) {
    if (marked.error.message.includes("payment mode is already recorded")) return "rejected";
    throw new Error("The payment mode could not be recorded.");
  }
  return "recorded";
}
