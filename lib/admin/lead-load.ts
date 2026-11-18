import "server-only";

import type { LeadEvent, LeadJob, LeadVisit, VisitStage } from "@/lib/admin/lead-metrics";
import { visitStages } from "@/lib/admin/lead-metrics";
import { createClient } from "@/lib/supabase/server";

const visitStageSet = new Set<string>(visitStages);
const authorizedStatuses = new Set(["authorized", "paid", "captured", "refunded"]);

type JobRow = {
  id: string;
  service: string;
  status: string;
  payment_status: string | null;
  captured_cents: number | null;
  refunded_cents: number | null;
  payment_due_at: string | null;
  customer_confirmed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type LeadLoad = {
  events: LeadEvent[];
  visits: LeadVisit[];
  jobs: LeadJob[];
  visitorStore: "ready" | "missing" | "unavailable";
  jobError: string | null;
  capped: boolean;
  visitCapped: boolean;
};

function missingTable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === "42P01" || error.code === "PGRST205" || /lead_visits|lead_events|job_attribution/.test(error.message ?? "");
}

function campaignName(metaId: string | null, utm: string | null): string | null {
  return metaId || utm || null;
}

export async function loadLeadAnalytics(input: {
  start: Date;
  end: Date;
  lane: "real" | "test" | "all";
}): Promise<LeadLoad> {
  const supabase = await createClient();
  const start = input.start.toISOString();
  const end = input.end.toISOString();
  let jobsQuery = supabase
    .from("jobs")
    .select("id, service, status, payment_status, captured_cents, refunded_cents, payment_due_at, customer_confirmed_at, created_at, updated_at, is_test")
    .or(`and(created_at.gte.${start},created_at.lt.${end}),and(updated_at.gte.${start},updated_at.lt.${end})`)
    .order("created_at", { ascending: false })
    .limit(2000);
  if (input.lane !== "all") jobsQuery = jobsQuery.eq("is_test", input.lane === "test");
  const jobsResult = await jobsQuery;
  if (jobsResult.error) {
    return { events: [], visits: [], jobs: [], visitorStore: "unavailable", jobError: "The request list could not be loaded.", capped: false, visitCapped: false };
  }
  const jobRows = (jobsResult.data ?? []) as JobRow[];
  const ids = jobRows.map((job) => job.id);
  const [attempts, payments, ledger, events, attribution, leadEvents, leadVisits] = await Promise.all([
    ids.length
      ? supabase.from("payment_attempts").select("job_id, outcome, created_at").in("job_id", ids)
      : Promise.resolve({ data: [], error: null }),
    ids.length
      ? supabase.from("job_payments").select("job_id, checkout_session_id, captured_at, updated_at").in("job_id", ids)
      : Promise.resolve({ data: [], error: null }),
    ids.length
      ? supabase.from("ledger_entries").select("job_id, status, updated_at").in("job_id", ids)
      : Promise.resolve({ data: [], error: null }),
    ids.length
      ? supabase.from("job_events").select("job_id, created_at, data").eq("type", "status").in("job_id", ids)
      : Promise.resolve({ data: [], error: null }),
    ids.length
      ? supabase
          .from("job_attribution")
          .select("job_id, first_utm_source, last_utm_source, first_utm_campaign, last_utm_campaign, first_referrer_host, last_referrer_host, first_meta_campaign_id, last_meta_campaign_id, first_meta_adset_id, last_meta_adset_id, first_meta_ad_id, last_meta_ad_id, first_landing_path")
          .in("job_id", ids)
      : Promise.resolve({ data: [], error: null }),
    supabase.from("lead_events").select("session_id, stage, service, created_at").gte("created_at", start).lt("created_at", end).limit(5000),
    supabase
      .from("lead_visits")
      .select("session_id, first_utm_source, utm_source, first_utm_campaign, utm_campaign, first_referrer_host, referrer_host, first_meta_campaign_id, meta_campaign_id, first_meta_adset_id, meta_adset_id, first_meta_ad_id, meta_ad_id, first_landing_path")
      .gte("last_seen_at", start)
      .lt("started_at", end)
      .limit(5000),
  ]);

  const started = new Map<string, string>();
  const authorizedAt = new Map<string, string>();
  for (const attempt of attempts.data ?? []) {
    if (attempt.outcome === "started" && !started.has(attempt.job_id)) started.set(attempt.job_id, attempt.created_at);
    if (attempt.outcome === "authorized" && !authorizedAt.has(attempt.job_id)) authorizedAt.set(attempt.job_id, attempt.created_at);
  }
  const paymentByJob = new Map((payments.data ?? []).map((row) => [row.job_id, row]));
  const ledgerByJob = new Map((ledger.data ?? []).map((row) => [row.job_id, row]));
  const delivered = new Map<string, string>();
  for (const event of events.data ?? []) {
    const to = (event.data as { to?: string } | null)?.to;
    if ((to === "delivered" || to === "completed") && !delivered.has(event.job_id)) delivered.set(event.job_id, event.created_at);
  }
  const attributionByJob = new Map((attribution.data ?? []).map((row) => [row.job_id, row]));
  const jobs: LeadJob[] = jobRows.map((row) => {
    const payment = paymentByJob.get(row.id);
    const entry = ledgerByJob.get(row.id);
    const source = attributionByJob.get(row.id);
    const capturedAt = payment?.captured_at ?? null;
    const authorized =
      authorizedAt.get(row.id) ??
      (authorizedStatuses.has(row.payment_status ?? "") || (row.captured_cents ?? 0) > 0
        ? row.customer_confirmed_at ?? capturedAt ?? row.updated_at
        : null);
    const checkout =
      started.get(row.id) ??
      (payment?.checkout_session_id ? payment.updated_at : null) ??
      authorized;
    return {
      id: row.id,
      service: row.service,
      status: row.status,
      createdAt: row.created_at,
      paymentStatus: row.payment_status,
      capturedCents: row.captured_cents,
      refundedCents: row.refunded_cents,
      paymentDueAt: row.payment_due_at,
      checkoutAt: checkout,
      authorizedAt: authorized,
      capturedAt,
      deliveredAt: delivered.get(row.id) ?? (row.status === "delivered" || row.status === "completed" ? row.updated_at : null),
      transferAt: entry?.status === "transferred" ? entry.updated_at : null,
      transferred: entry?.status === "transferred",
      firstUtmSource: source?.first_utm_source ?? null,
      lastUtmSource: source?.last_utm_source ?? null,
      firstReferrerHost: source?.first_referrer_host ?? null,
      lastReferrerHost: source?.last_referrer_host ?? null,
      firstCampaign: source ? campaignName(source.first_meta_campaign_id, source.first_utm_campaign) : null,
      lastCampaign: source ? campaignName(source.last_meta_campaign_id, source.last_utm_campaign) : null,
      firstAdset: source?.first_meta_adset_id ?? null,
      lastAdset: source?.last_meta_adset_id ?? null,
      firstAd: source?.first_meta_ad_id ?? null,
      lastAd: source?.last_meta_ad_id ?? null,
    };
  });

  const visitorMissing = missingTable(leadEvents.error) || missingTable(leadVisits.error);
  const visitorFailed = Boolean(leadEvents.error || leadVisits.error) && !visitorMissing;
  const loadedEvents: LeadEvent[] = visitorMissing || visitorFailed
    ? []
    : (leadEvents.data ?? []).flatMap((row) => {
        if (!visitStageSet.has(row.stage)) return [];
        return [{
          sessionId: row.session_id,
          stage: row.stage as VisitStage,
          service: row.service,
          at: row.created_at,
        }];
      });
  const visits: LeadVisit[] = visitorMissing || visitorFailed
    ? []
    : (leadVisits.data ?? []).map((row) => ({
        sessionId: row.session_id,
        firstUtmSource: row.first_utm_source,
        lastUtmSource: row.utm_source,
        firstReferrerHost: row.first_referrer_host,
        lastReferrerHost: row.referrer_host,
        firstCampaign: campaignName(row.first_meta_campaign_id, row.first_utm_campaign),
        lastCampaign: campaignName(row.meta_campaign_id, row.utm_campaign),
        firstAdset: row.first_meta_adset_id,
        lastAdset: row.meta_adset_id,
        firstAd: row.first_meta_ad_id,
        lastAd: row.meta_ad_id,
        landingPath: row.first_landing_path,
      }));

  return {
    events: loadedEvents,
    visits,
    jobs,
    visitorStore: visitorMissing ? "missing" : visitorFailed ? "unavailable" : "ready",
    jobError: attempts.error || payments.error || ledger.error ? "Some payment details could not be loaded." : null,
    capped: jobRows.length >= 2000 || (leadEvents.data?.length ?? 0) >= 5000,
    visitCapped: (leadEvents.data?.length ?? 0) >= 5000 || (leadVisits.data?.length ?? 0) >= 5000,
  };
}

/** Consented visit steps for the visit funnel. Jobs, payments, and customer details are not read. */
export async function loadVisitActivity(start: Date, end: Date): Promise<{
  events: LeadEvent[];
  visits: LeadVisit[];
  capped: boolean;
  error: string | null;
}> {
  const supabase = await createClient();
  const startIso = start.toISOString();
  const endIso = end.toISOString();
  const [leadEvents, leadVisits] = await Promise.all([
    supabase.from("lead_events").select("session_id, stage, service, created_at").gte("created_at", startIso).lt("created_at", endIso).limit(5000),
    supabase
      .from("lead_visits")
      .select("session_id, first_utm_source, utm_source, first_utm_campaign, utm_campaign, first_referrer_host, referrer_host, first_meta_campaign_id, meta_campaign_id, first_meta_adset_id, meta_adset_id, first_meta_ad_id, meta_ad_id, first_landing_path")
      .gte("last_seen_at", startIso)
      .lt("started_at", endIso)
      .limit(5000),
  ]);
  if (missingTable(leadEvents.error) || missingTable(leadVisits.error)) {
    return { events: [], visits: [], capped: false, error: "Visit and campaign tracking is not installed in the database yet." };
  }
  if (leadEvents.error || leadVisits.error) {
    return { events: [], visits: [], capped: false, error: "Visit sessions could not be loaded." };
  }
  const events: LeadEvent[] = (leadEvents.data ?? []).flatMap((row) => {
    if (!visitStageSet.has(row.stage)) return [];
    return [{ sessionId: row.session_id, stage: row.stage as LeadEvent["stage"], service: row.service, at: row.created_at }];
  });
  const visits: LeadVisit[] = (leadVisits.data ?? []).map((row) => ({
    sessionId: row.session_id,
    firstUtmSource: row.first_utm_source,
    lastUtmSource: row.utm_source,
    firstReferrerHost: row.first_referrer_host,
    lastReferrerHost: row.referrer_host,
    firstCampaign: campaignName(row.first_meta_campaign_id, row.first_utm_campaign),
    lastCampaign: campaignName(row.meta_campaign_id, row.utm_campaign),
    firstAdset: row.first_meta_adset_id,
    lastAdset: row.meta_adset_id,
    firstAd: row.first_meta_ad_id,
    lastAd: row.meta_ad_id,
    landingPath: row.first_landing_path,
  }));
  return {
    events,
    visits,
    capped: (leadEvents.data?.length ?? 0) >= 5000 || (leadVisits.data?.length ?? 0) >= 5000,
    error: null,
  };
}
