import "server-only";

import { createClient } from "@/lib/supabase/server";

const signedUrlSeconds = 300;

export type JobSummary = {
  id: string;
  service: string;
  status: string;
  created_at: string;
  pricing_method: string;
  pickup_area: string;
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
  private: {
    customer_name: string;
    customer_phone: string;
    customer_email: string | null;
    pickup_address: string;
    dropoff_address: string | null;
    access_notes: string | null;
  } | null;
  events: JobEvent[];
  photos: JobPhoto[];
};

export async function listOwnJobs(): Promise<{ jobs: JobSummary[]; error: boolean }> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("jobs")
      .select("id, service, status, created_at, pricing_method, pickup_area")
      .order("created_at", { ascending: false });
    if (error) return { jobs: [], error: true };
    return { jobs: data ?? [], error: false };
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
        "id, service, status, created_at, pricing_method, offer_cents, budget_min_cents, budget_max_cents, price_cents, pickup_area, dropoff_area, description, pieces, size, needs_value_approval, preferred_date, time_window, source, junk_load_size",
      )
      .eq("id", id)
      .maybeSingle();
    if (error || !job) return null;

    const [privateResult, eventResult, photoResult] = await Promise.all([
      supabase
        .from("job_private")
        .select("customer_name, customer_phone, customer_email, pickup_address, dropoff_address, access_notes")
        .eq("job_id", id)
        .maybeSingle(),
      supabase
        .from("job_events")
        .select("id, type, created_at, data")
        .eq("job_id", id)
        .order("created_at", { ascending: true }),
      supabase
        .from("job_photos")
        .select("id, storage_path")
        .eq("job_id", id)
        .eq("stage", "request")
        .order("created_at", { ascending: true }),
    ]);

    const photos: JobPhoto[] = [];
    for (const photo of photoResult.data ?? []) {
      const signed = await supabase.storage
        .from("job-photos")
        .createSignedUrl(photo.storage_path, signedUrlSeconds);
      if (signed.data?.signedUrl) {
        photos.push({ id: photo.id, url: signed.data.signedUrl });
      }
    }

    return {
      ...job,
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
    };
  } catch {
    return null;
  }
}
