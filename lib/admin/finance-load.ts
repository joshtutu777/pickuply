import "server-only";

import { firstName } from "@/lib/auth/name";
import { areaParts, type FinanceJob } from "@/lib/admin/finance";
import { connectLivemode } from "@/lib/payments/connect-eligibility";
import { paymentsMode } from "@/lib/payments/payments-mode";
import { createClient } from "@/lib/supabase/server";

type JobRow = {
  id: string;
  customer_id: string;
  assigned_driver_id: string | null;
  service: string;
  status: string;
  pricing_method: "quote" | "fixed" | "range";
  pickup_area: string | null;
  price_cents: number | null;
  driver_pay_cents: number | null;
  captured_cents: number | null;
  refunded_cents: number | null;
  platform_fee_cents: number | null;
  service_fee_cents: number | null;
  trip_fee_cents: number | null;
  late_cancel_cents: number | null;
  payment_status: string | null;
  payment_due_at: string | null;
  created_at: string;
  updated_at: string;
  customer_confirmed_at: string | null;
};

export async function loadFinanceJobs(lane: "real" | "test" | "all" = "real"): Promise<{ jobs: FinanceJob[]; error: string | null }> {
  const supabase = await createClient();
  let jobsQuery = supabase
    .from("jobs")
    .select("id, customer_id, assigned_driver_id, service, status, pricing_method, pickup_area, price_cents, driver_pay_cents, captured_cents, refunded_cents, platform_fee_cents, service_fee_cents, trip_fee_cents, late_cancel_cents, payment_status, payment_due_at, created_at, updated_at, customer_confirmed_at, is_test")
    .not("payment_status", "is", null)
    .order("created_at", { ascending: false })
    .limit(2000);
  if (lane !== "all") jobsQuery = jobsQuery.eq("is_test", lane === "test");
  const jobsResult = await jobsQuery;
  if (jobsResult.error) return { jobs: [], error: "The payment list could not be loaded." };
  const jobs = (jobsResult.data ?? []) as JobRow[];
  const ids = jobs.map((job) => job.id);
  const people = [...new Set(jobs.flatMap((job) => [job.customer_id, job.assigned_driver_id].filter(Boolean)))] as string[];
  const [payments, ledger, disputes, reports, profiles, events, accounts, cases, refunds] = await Promise.all([
    ids.length
      ? supabase.from("job_payments").select("job_id, payment_intent_id, capture_before, stripe_fee_cents, captured_at").in("job_id", ids)
      : Promise.resolve({ data: [], error: null }),
    ids.length
      ? supabase.from("ledger_entries").select("job_id, amount_cents, status, hold_reason, transfer_status, stripe_transfer_id, available_on, updated_at, entry_kind").in("job_id", ids)
      : Promise.resolve({ data: [], error: null }),
    ids.length ? supabase.from("card_disputes").select("job_id, status").in("job_id", ids) : Promise.resolve({ data: [], error: null }),
    ids.length ? supabase.from("job_disputes").select("job_id, resolved_at, capture_hold").in("job_id", ids) : Promise.resolve({ data: [], error: null }),
    people.length ? supabase.from("profiles").select("id, full_name").in("id", people) : Promise.resolve({ data: [], error: null }),
    ids.length ? supabase.from("job_events").select("job_id, created_at, data").eq("type", "status").in("job_id", ids) : Promise.resolve({ data: [], error: null }),
    people.length
      ? supabase
          .from("driver_connect_accounts")
          .select("driver_id, payouts_enabled, transfers_active, livemode")
          .in("driver_id", people)
          .eq("livemode", connectLivemode(paymentsMode(process.env.PAYMENTS_MODE)))
      : Promise.resolve({ data: [], error: null }),
    ids.length ? supabase.from("help_requests").select("job_id, case_number").in("job_id", ids) : Promise.resolve({ data: [], error: null }),
    ids.length ? supabase.from("refund_requests").select("job_id, created_at, status").eq("status", "succeeded").in("job_id", ids) : Promise.resolve({ data: [], error: null }),
  ]);
  if (payments.error || ledger.error || profiles.error) return { jobs: [], error: "The payment details could not be loaded." };

  const paymentByJob = new Map((payments.data ?? []).map((row) => [row.job_id, row]));
  const ledgerByJob = new Map((ledger.data ?? []).filter((row) => row.entry_kind !== "tip").map((row) => [row.job_id, row]));
  const names = new Map((profiles.data ?? []).map((row) => [row.id, row.full_name]));
  const payouts = new Map((accounts.data ?? []).map((row) => [row.driver_id, Boolean(row.payouts_enabled && row.transfers_active)]));
  const openDispute = new Set((disputes.data ?? []).filter((row) => row.status !== "won" && row.status !== "lost" && row.status !== "warning_closed").map((row) => row.job_id));
  const openReport = new Set((reports.data ?? []).filter((row) => row.resolved_at == null && row.capture_hold).map((row) => row.job_id));
  const booked = new Map<string, string>();
  for (const event of events.data ?? []) {
    const to = (event.data as { to?: string } | null)?.to;
    if (to === "assigned" && !booked.has(event.job_id)) booked.set(event.job_id, event.created_at);
  }
  const refundedAt = new Map<string, string>();
  for (const refund of refunds.data ?? []) {
    if (!refundedAt.has(refund.job_id)) refundedAt.set(refund.job_id, refund.created_at);
  }
  const caseNumber = new Map<string, string>();
  for (const item of cases.data ?? []) {
    if (item.job_id && !caseNumber.has(item.job_id)) caseNumber.set(item.job_id, item.case_number);
  }

  return {
    error: null,
    jobs: jobs.map((row) => {
      const area = areaParts(row.pickup_area);
      const payment = paymentByJob.get(row.id);
      const entry = ledgerByJob.get(row.id);
      const paidOut = entry && (entry.status === "transferred" || entry.status === "externally_paid") ? entry.updated_at : null;
      return {
        id: row.id,
        customerId: row.customer_id,
        customerFirst: firstName(names.get(row.customer_id)),
        driverId: row.assigned_driver_id,
        driverFirst: row.assigned_driver_id ? firstName(names.get(row.assigned_driver_id)) : null,
        service: row.service,
        pricingMethod: row.pricing_method,
        jobStatus: row.status,
        paymentStatus: row.payment_status,
        pickupCity: area.city,
        pickupZip: area.zip,
        priceCents: row.price_cents,
        driverPayCents: row.driver_pay_cents,
        capturedCents: row.captured_cents,
        refundedCents: row.refunded_cents,
        platformFeeCents: row.platform_fee_cents,
        serviceFeeCents: row.service_fee_cents,
        stripeFeeCents: payment?.stripe_fee_cents ?? null,
        tripFeeCents: row.trip_fee_cents,
        lateCancelCents: row.late_cancel_cents,
        paymentDueAt: row.payment_due_at,
        captureBefore: payment?.capture_before ?? null,
        createdAt: row.created_at,
        jobUpdatedAt: row.updated_at,
        customerConfirmedAt: row.customer_confirmed_at,
        bookedAt: booked.get(row.id) ?? null,
        capturedAt: payment?.captured_at ?? null,
        refundedAt: refundedAt.get(row.id) ?? null,
        paidOutAt: paidOut,
        paymentIntentId: payment?.payment_intent_id ?? null,
        ledgerStatus: (entry?.status ?? null) as FinanceJob["ledgerStatus"],
        ledgerAmountCents: entry?.amount_cents ?? null,
        transferStatus: (entry?.transfer_status ?? null) as FinanceJob["transferStatus"],
        transferId: entry?.stripe_transfer_id ?? null,
        holdReason: entry?.hold_reason ?? null,
        ledgerAvailableOn: entry?.available_on ?? null,
        openReport: openReport.has(row.id),
        openDispute: openDispute.has(row.id),
        payoutsEnabled: row.assigned_driver_id ? (payouts.get(row.assigned_driver_id) ?? false) : null,
        caseNumber: caseNumber.get(row.id) ?? null,
      } satisfies FinanceJob;
    }),
  };
}
