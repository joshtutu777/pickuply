import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { PickupWindowPlan } from "@/lib/time/pickup-schedule";

const signedUrlSeconds = 300;

export type JobSummary = {
  id: string;
  service: string;
  status: string;
  created_at: string;
  updated_at: string;
  pricing_method: string;
  pickup_area: string;
  dropoff_area: string | null;
  description: string;
  preferred_date: string;
  time_window: string | null;
  payment_status: string | null;
  dump_fee_cents: number | null;
  price_cents: number | null;
  service_fee_cents: number | null;
  assigned_driver_id: string | null;
  test_retired_at: string | null;
  activeOffers: number;
  newOffers: number;
};

export type JobPhoto = {
  id: string;
  url: string;
};

export type JobEvent = {
  id: string;
  type: string;
  created_at: string;
  to_status: string | null;
};

export type JobDetail = {
  id: string;
  service: string;
  status: string;
  created_at: string;
  pricing_method: string;
  offer_cents: number | null;
  budget_min_cents: number | null;
  budget_max_cents: number | null;
  price_cents: number | null;
  driver_pay_cents: number | null;
  platform_fee_cents: number | null;
  service_fee_cents: number | null;
  service_fee_bps: number | null;
  payment_due_at: string | null;
  customer_confirmed_at: string | null;
  captured_cents: number | null;
  refunded_cents: number;
  trip_fee_cents: number | null;
  pickup_area: string;
  dropoff_area: string | null;
  description: string;
  pieces: number;
  size: string;
  needs_value_approval: boolean;
  preferred_date: string;
  time_window: string | null;
  source: string | null;
  junk_load_size: string | null;
  payment_status: string | null;
  dump_fee_cents: number | null;
  require_disposal_receipt: boolean;
  assigned_driver_id: string | null;
  distance_miles: number | null;
  distance_source: string | null;
  updated_at: string;
  has_dump_receipt: boolean;
  pickup_review_until: string | null;
  dropoff_arrived_at: string | null;
  pickup_availability: string | null;
  pickup_timezone: string | null;
  scheduled_pickup_start: string | null;
  scheduled_pickup_end: string | null;
  pickup_windows: PickupWindowPlan[];
  private: {
    customer_name: string;
    customer_phone: string;
    customer_email: string | null;
    pickup_address: string;
    dropoff_address: string | null;
    access_notes: string | null;
    pickup_unit: string | null;
    dropoff_unit: string | null;
    pickup_lat: number | null;
    pickup_lng: number | null;
    dropoff_lat: number | null;
    dropoff_lng: number | null;
    pickup_verified: boolean | null;
    dropoff_verified: boolean | null;
  } | null;
  events: JobEvent[];
  photos: JobPhoto[];
};

export async function listOwnJobs(): Promise<{ jobs: JobSummary[]; error: boolean }> {
  try {
    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return { jobs: [], error: true };
    const [jobsResult, countsResult] = await Promise.all([
      supabase
        .from("jobs")
        .select(
          "id, service, status, created_at, updated_at, pricing_method, pickup_area, dropoff_area, description, preferred_date, time_window, payment_status, dump_fee_cents, price_cents, service_fee_cents, assigned_driver_id, test_retired_at",
        )
        .eq("customer_id", auth.user.id)
        .order("created_at", { ascending: false }),
      supabase.rpc("customer_offer_counts"),
    ]);
    if (jobsResult.error || countsResult.error) return { jobs: [], error: true };
    const counts = new Map<string, { active: number; fresh: number }>();
    for (const row of (countsResult.data ?? []) as { job_id: string; active_offers: number; new_offers: number }[]) {
      counts.set(row.job_id, { active: Number(row.active_offers), fresh: Number(row.new_offers) });
    }
    const jobs = (jobsResult.data ?? []).map((job) => {
      const count = counts.get(job.id);
      return { ...job, activeOffers: count?.active ?? 0, newOffers: count?.fresh ?? 0 };
    });
    return { jobs, error: false };
  } catch {
    return { jobs: [], error: true };
  }
}

export async function listAllJobs(): Promise<{ jobs: JobSummary[]; error: boolean }> {
  return listOwnJobs();
}

export async function getJobDetail(id: string): Promise<JobDetail | null> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return null;
  }
  try {
    const supabase = await createClient();
    const { data: job, error } = await supabase
      .from("jobs")
      .select(
        "id, service, status, created_at, updated_at, pricing_method, offer_cents, budget_min_cents, budget_max_cents, price_cents, driver_pay_cents, platform_fee_cents, service_fee_cents, service_fee_bps, payment_due_at, customer_confirmed_at, captured_cents, refunded_cents, trip_fee_cents, pickup_area, dropoff_area, description, pieces, size, needs_value_approval, preferred_date, time_window, source, junk_load_size, payment_status, dump_fee_cents, require_disposal_receipt, assigned_driver_id, distance_miles, distance_source, pickup_review_until, dropoff_arrived_at, pickup_availability, pickup_timezone, scheduled_pickup_start, scheduled_pickup_end",
      )
      .eq("id", id)
      .maybeSingle();
    if (error || !job) return null;

    const [privateResult, eventResult, photoResult, windowResult] = await Promise.all([
      supabase
        .from("job_private")
        .select("customer_name, customer_phone, customer_email, pickup_address, dropoff_address, access_notes, pickup_unit, dropoff_unit, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng, pickup_verified, dropoff_verified")
        .eq("job_id", id)
        .maybeSingle(),
      supabase
        .from("job_events")
        .select("id, type, created_at, data")
        .eq("job_id", id)
        .order("created_at", { ascending: true }),
      supabase
        .from("job_photos")
        .select("id, storage_path, stage")
        .eq("job_id", id)
        .in("stage", ["request", "dump_receipt"])
        .order("created_at", { ascending: true }),
      supabase
        .from("job_pickup_windows")
        .select("id, starts_at, ends_at, position")
        .eq("job_id", id)
        .order("position", { ascending: true }),
    ]);

    const photos: JobPhoto[] = [];
    const hasDumpReceipt = (photoResult.data ?? []).some((photo) => photo.stage === "dump_receipt");
    for (const photo of (photoResult.data ?? []).filter((item) => item.stage === "request")) {
      const signed = await supabase.storage
        .from("job-photos")
        .createSignedUrl(photo.storage_path, signedUrlSeconds);
      if (signed.data?.signedUrl) {
        photos.push({ id: photo.id, url: signed.data.signedUrl });
      }
    }

    return {
      ...job,
      has_dump_receipt: hasDumpReceipt,
      private: privateResult.data,
      events: (eventResult.data ?? []).map((event) => {
        const data = event.data as { to?: string } | null;
        return {
          id: event.id,
          type: event.type,
          created_at: event.created_at,
          to_status: typeof data?.to === "string" ? data.to : null,
        };
      }),
      photos,
      pickup_windows: (windowResult.data ?? []) as PickupWindowPlan[],
    };
  } catch {
    return null;
  }
}
