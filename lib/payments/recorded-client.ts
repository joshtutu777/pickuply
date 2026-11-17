import "server-only";

import type Stripe from "stripe";
import { getStripeForRecordedMode } from "@/lib/stripe";
import { createServiceClient } from "@/lib/supabase/service";

/** The Stripe client for a job's saved payment mode. A missing flag stays on the test key. */
export async function stripeForJob(jobId: string): Promise<Stripe> {
  const payment = await createServiceClient()
    .from("job_payments")
    .select("stripe_livemode")
    .eq("job_id", jobId)
    .maybeSingle();
  if (payment.error) throw new Error("The payment mode could not be read.");
  return getStripeForRecordedMode(payment.data?.stripe_livemode === true);
}
