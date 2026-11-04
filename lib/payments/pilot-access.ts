import "server-only";

import { pilotCheckoutAction, type PilotCheckoutAction } from "@/lib/payments/live-pilot";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * Reads the signed-in customer and the saved job.
 * The allowlist comes from server environment variables, not from the request.
 * Any missing or failed read stays closed.
 */
export async function loadPilotCheckout(jobId: string): Promise<PilotCheckoutAction> {
  try {
    const supabase = await createClient();
    const user = await supabase.auth.getUser();
    const service = createServiceClient();
    const job = await service
      .from("jobs")
      .select(
        "customer_id, is_test, status, payment_status, payment_due_at, price_cents, driver_pay_cents, platform_fee_cents, service_fee_cents, assigned_driver_id",
      )
      .eq("id", jobId)
      .maybeSingle();
    if (job.error || !job.data) return "block";
    const driverId = job.data.assigned_driver_id;
    const [customer, driverProfile, driver, connect, payment, attempts, dispute] = await Promise.all([
      service.from("profiles").select("is_test").eq("id", job.data.customer_id).maybeSingle(),
      driverId
        ? service.from("profiles").select("is_test").eq("id", driverId).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      driverId
        ? service.from("drivers").select("status, driving_stopped_at").eq("profile_id", driverId).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      driverId
        ? service
            .from("driver_connect_accounts")
            .select("payouts_enabled, transfers_active, details_submitted")
            .eq("driver_id", driverId)
            .eq("livemode", true)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      service.from("job_payments").select("checkout_session_id").eq("job_id", jobId).maybeSingle(),
      service.from("payment_attempts").select("checkout_session_id").eq("job_id", jobId).limit(10),
      service.from("job_disputes").select("capture_hold").eq("job_id", jobId).eq("capture_hold", true).limit(1),
    ]);
    if (customer.error || driverProfile.error || driver.error || connect.error || payment.error || attempts.error || dispute.error) {
      return "block";
    }
    const offer = (job.data.driver_pay_cents ?? 0) + (job.data.platform_fee_cents ?? 0);
    const total = offer + (job.data.service_fee_cents ?? 0);
    const sessionIds = [
      payment.data?.checkout_session_id,
      ...(attempts.data ?? []).map((row) => row.checkout_session_id),
    ];
    const successful = new Set(["authorized", "paid", "captured"]);
    return pilotCheckoutAction({
      pilotEnabled: process.env.LIVE_PILOT_ENABLED,
      allowCustomerId: process.env.LIVE_PILOT_CUSTOMER_ID,
      allowJobId: process.env.LIVE_PILOT_JOB_ID,
      authenticatedCustomerId: user.data.user?.id ?? null,
      jobId,
      jobCustomerId: job.data.customer_id,
      jobIsTest: job.data.is_test === true,
      customerIsTest: customer.data?.is_test === true,
      driverIsTest: driverProfile.data?.is_test === true,
      driverStatus: driver.data?.status ?? null,
      drivingStopped: driver.data?.driving_stopped_at != null,
      livePayoutsEnabled: connect.data?.payouts_enabled === true,
      liveTransfersActive: connect.data?.transfers_active === true,
      liveDetailsSubmitted: connect.data?.details_submitted === true,
      jobStatus: job.data.status,
      paymentStatus: job.data.payment_status,
      paymentDueAt: job.data.payment_due_at,
      priceCents: job.data.price_cents,
      priceAddsUp: job.data.price_cents != null && total === job.data.price_cents,
      paymentOnHold: (dispute.data ?? []).length > 0,
      hasSuccessfulPayment: successful.has(job.data.payment_status ?? ""),
      hasActiveCheckout: sessionIds.some((id) => typeof id === "string" && id.startsWith("cs_")),
      now: Date.now(),
    });
  } catch {
    return "block";
  }
}
