import "server-only";

import { cache } from "react";
import { coverageSummary } from "@/lib/driver/coverage";
import { requireAdmin } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import {
  activityHref,
  actorLabel,
  auditLabel,
  dashboardCounts,
  documentExpiresSoon,
  isOverThousand,
  isSpecialty,
  jobEventLabel,
  needsAction,
  type ActivityItem,
  type AdminDriver,
  type AdminJob,
  type DashboardCounts,
  type NeedsActionItem,
} from "@/lib/admin/ops";

export type AdminZone = { id: string; name: string };

export type AdminDashboard = {
  error: false;
  jobs: AdminJob[];
  drivers: AdminDriver[];
  zones: AdminZone[];
  activity: ActivityItem[];
  counts: DashboardCounts;
  needs: NeedsActionItem[];
  now: number;
};

export type AdminDashboardResult = AdminDashboard | { error: true };

type ProfileRow = { id: string; full_name: string | null; role: string | null };

export const loadAdminDashboard = cache(async function loadAdminDashboard(): Promise<AdminDashboardResult> {
  await requireAdmin("/admin");
  const now = Date.now();
  try {
    const supabase = await createClient();
    const [jobsResult, driversResult, coverageResult, reviewsResult, zonesResult, offersResult, photosResult, openedResult, eventsResult, auditResult] =
      await Promise.all([
        supabase
          .from("jobs")
          .select(
            "id, service, status, created_at, pricing_method, pickup_area, zone_id, payment_status, payment_due_at, quote_expires_at, assigned_driver_id, preferred_date, item_value_cents, offer_cents, budget_min_cents, budget_max_cents, price_cents, description, junk_special_items, detail_request",
          )
          .order("created_at", { ascending: false })
          .limit(2000),
        supabase
          .from("drivers")
          .select("profile_id, status, home_city, zone_id, is_online, license_expires, insurance_expires, created_at")
          .order("created_at", { ascending: true })
          .limit(2000),
        supabase.from("driver_feed_filters").select("profile_id, cities, zips, radius_miles").limit(2000),
        supabase.from("driver_item_reviews").select("driver_id").limit(2000),
        supabase.from("zones").select("id, name").order("name"),
        supabase.from("job_offers").select("job_id").limit(5000),
        supabase.from("job_photos").select("job_id").eq("stage", "request").limit(5000),
        supabase
          .from("job_events")
          .select("job_id, created_at, data")
          .eq("type", "status")
          .order("created_at", { ascending: false })
          .limit(5000),
        supabase
          .from("job_events")
          .select("id, job_id, actor_id, type, data, created_at")
          .order("created_at", { ascending: false })
          .limit(25),
        supabase
          .from("audit_log")
          .select("id, actor_id, action, target_type, target_id, data, created_at")
          .order("created_at", { ascending: false })
          .limit(25),
      ]);

    if (
      jobsResult.error ||
      driversResult.error ||
      coverageResult.error ||
      reviewsResult.error ||
      zonesResult.error ||
      offersResult.error ||
      photosResult.error ||
      openedResult.error ||
      eventsResult.error ||
      auditResult.error
    ) {
      return { error: true };
    }

    const offerCounts = new Map<string, number>();
    for (const offer of offersResult.data ?? []) {
      offerCounts.set(offer.job_id, (offerCounts.get(offer.job_id) ?? 0) + 1);
    }
    const photoJobs = new Set((photosResult.data ?? []).map((photo) => photo.job_id));
    const openedAt = new Map<string, string>();
    const quotedAt = new Map<string, string>();
    for (const event of openedResult.data ?? []) {
      const to = event.data && typeof event.data === "object" && "to" in event.data ? event.data.to : null;
      if (to === "open" && !openedAt.has(event.job_id)) openedAt.set(event.job_id, event.created_at);
      if (to === "quoted" && !quotedAt.has(event.job_id)) quotedAt.set(event.job_id, event.created_at);
    }

    const profileIds = new Set<string>();
    for (const driver of driversResult.data ?? []) profileIds.add(driver.profile_id);
    for (const job of jobsResult.data ?? []) {
      if (job.assigned_driver_id) profileIds.add(job.assigned_driver_id);
    }
    for (const event of eventsResult.data ?? []) {
      if (event.actor_id) profileIds.add(event.actor_id);
    }
    for (const entry of auditResult.data ?? []) {
      if (entry.actor_id) profileIds.add(entry.actor_id);
    }

    const profiles = new Map<string, ProfileRow>();
    if (profileIds.size > 0) {
      const profileResult = await supabase
        .from("profiles")
        .select("id, full_name, role")
        .in("id", [...profileIds]);
      if (profileResult.error) return { error: true };
      for (const profile of profileResult.data ?? []) profiles.set(profile.id, profile);
    }

    const jobs: AdminJob[] = (jobsResult.data ?? []).map((job) => ({
      id: job.id,
      service: job.service,
      status: job.status,
      createdAt: job.created_at,
      pricingMethod: job.pricing_method,
      pickupArea: job.pickup_area,
      zoneId: job.zone_id,
      paymentStatus: job.payment_status,
      paymentDueAt: job.payment_due_at,
      quoteExpiresAt: job.quote_expires_at,
      assignedDriverId: job.assigned_driver_id,
      preferredDate: job.preferred_date,
      itemValueCents: job.item_value_cents,
      offerCents: job.offer_cents,
      budgetMinCents: job.budget_min_cents,
      budgetMaxCents: job.budget_max_cents,
      priceCents: job.price_cents,
      openedAt: openedAt.get(job.id) ?? null,
      quotedAt: quotedAt.get(job.id) ?? null,
      offerCount: offerCounts.get(job.id) ?? 0,
      hasRequestPhotos: photoJobs.has(job.id),
      overThousand: isOverThousand(job.item_value_cents),
      specialty: isSpecialty(job.description, job.junk_special_items),
      detailsOpen: detailRequestOpen(job.detail_request),
    }));

    const changedDrivers = new Set((reviewsResult.data ?? []).map((row) => row.driver_id));
    const coverageByDriver = new Map(
      (coverageResult.data ?? []).map((row) => [
        row.profile_id,
        coverageSummary({
          cities: row.cities ?? [],
          zips: row.zips ?? [],
          radiusMiles: row.radius_miles,
        }),
      ]),
    );
    const drivers: AdminDriver[] = (driversResult.data ?? []).map((driver) => ({
      id: driver.profile_id,
      status: driver.status,
      homeCity: driver.home_city,
      zoneId: driver.zone_id,
      online: driver.is_online,
      licenseExpires: driver.license_expires,
      insuranceExpires: driver.insurance_expires,
      createdAt: driver.created_at,
      name: profiles.get(driver.profile_id)?.full_name ?? null,
      needsChanges: changedDrivers.has(driver.profile_id),
      coverage: coverageByDriver.get(driver.profile_id) || null,
    }));

    const zones = (zonesResult.data ?? []).map((zone) => ({ id: zone.id, name: zone.name }));
    const needs = needsAction(jobs, drivers, now);
    const activity = buildActivity(eventsResult.data ?? [], auditResult.data ?? [], profiles);

    return {
      error: false,
      jobs,
      drivers,
      zones,
      activity,
      counts: dashboardCounts(jobs, drivers, now),
      needs,
      now,
    };
  } catch {
    return { error: true };
  }
});

function detailRequestOpen(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  return (value as { answered_at?: unknown }).answered_at == null;
}

function buildActivity(
  events: {
    id: string;
    job_id: string;
    actor_id: string | null;
    type: string;
    data: unknown;
    created_at: string;
  }[],
  audits: {
    id: string;
    actor_id: string | null;
    action: string;
    target_type: string | null;
    target_id: string | null;
    data: unknown;
    created_at: string;
  }[],
  profiles: Map<string, ProfileRow>,
): ActivityItem[] {
  const rows: ActivityItem[] = [
    ...events.map((event) => {
      const profile = event.actor_id ? profiles.get(event.actor_id) : undefined;
      return {
        id: `event-${event.id}`,
        at: event.created_at,
        actor: actorLabel(profile?.role ?? null, profile?.full_name ?? null),
        label: jobEventLabel(event.type, event.data),
        href: activityHref("job", event.job_id),
      };
    }),
    ...audits.map((entry) => {
      const profile = entry.actor_id ? profiles.get(entry.actor_id) : undefined;
      return {
        id: `audit-${entry.id}`,
        at: entry.created_at,
        actor: actorLabel(profile?.role ?? null, profile?.full_name ?? null),
        label: auditLabel(entry.action, entry.data),
        href: activityHref(entry.target_type, entry.target_id),
      };
    }),
  ];
  return rows.sort((left, right) => right.at.localeCompare(left.at) || left.id.localeCompare(right.id)).slice(0, 25);
}

export function expiringDrivers(drivers: AdminDriver[], now: number): AdminDriver[] {
  return drivers.filter(
    (driver) =>
      driver.status !== "removed" &&
      (documentExpiresSoon(driver.licenseExpires, now) || documentExpiresSoon(driver.insuranceExpires, now)),
  );
}
