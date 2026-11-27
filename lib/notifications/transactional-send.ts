import "server-only";

import { after } from "next/server";
import { publicSiteUrl } from "@/lib/blog/site";
import { cityFromArea } from "@/lib/jobs/next-action";
import { sendTransactionalSms } from "@/lib/sms";
import { createServiceClient } from "@/lib/supabase/service";
import {
  deliverPlans,
  followupWindow,
  followupWindowStart,
  knownDriverEarnings,
  planAckReminder,
  planAdminAck,
  planFollowup,
  planLifecycle,
  planNoOffer,
  runTransactionalPass,
  type AudienceMode,
  type BookingNotice,
  type PlannedSms,
  type TimerJob,
  type TransactionalIo,
  type TransactionalSettings,
} from "@/lib/notifications/transactional";

type ServiceClient = ReturnType<typeof createServiceClient>;

type Person = {
  role: BookingNotice["role"];
  isTest: boolean;
  online: boolean;
  smsEnabled: boolean;
  optedOut: boolean;
  hasConsent: boolean;
  phone: string | null;
};

type JobRow = {
  id: string;
  service: string;
  pickup_area: string | null;
  preferred_date: string | null;
  pricing_method: string;
  offer_cents: number | null;
  driver_pay_cents: number | null;
  is_test: boolean;
  status: string;
  customer_id: string;
  assigned_driver_id: string | null;
  created_at: string;
};

const audiences = new Set<AudienceMode>(["eligible", "online", "off"]);

function roleOf(value: string | null): BookingNotice["role"] {
  if (value === "customer" || value === "driver" || value === "admin") return value;
  return "other";
}

async function loadPeople(supabase: ServiceClient, ids: string[]): Promise<Map<string, Person>> {
  const unique = [...new Set(ids)];
  const people = new Map<string, Person>();
  if (unique.length === 0) return people;
  const [{ data: profiles }, { data: drivers }, { data: prefs }, { data: consents }] = await Promise.all([
    supabase.from("profiles").select("id, role, is_test").in("id", unique),
    supabase.from("drivers").select("profile_id, is_online").in("profile_id", unique),
    supabase.from("notification_preferences").select("profile_id, sms_enabled").in("profile_id", unique),
    supabase.from("sms_consents").select("profile_id, opted_out_at, consented_at").in("profile_id", unique),
  ]);
  const online = new Map((drivers ?? []).map((row) => [row.profile_id as string, Boolean(row.is_online)]));
  const enabled = new Map((prefs ?? []).map((row) => [row.profile_id as string, Boolean(row.sms_enabled)]));
  const latestConsent = new Map<string, { opted_out_at: string | null; consented_at: string }>();
  for (const row of consents ?? []) {
    const current = latestConsent.get(row.profile_id as string);
    if (!current || String(row.consented_at) > current.consented_at) {
      latestConsent.set(row.profile_id as string, {
        opted_out_at: row.opted_out_at as string | null,
        consented_at: String(row.consented_at),
      });
    }
  }
  const phones = new Map<string, string | null>();
  await Promise.all(
    unique.map(async (id) => {
      const { data } = await supabase.auth.admin.getUserById(id);
      phones.set(id, data.user?.phone ?? null);
    }),
  );
  for (const profile of profiles ?? []) {
    const consent = latestConsent.get(profile.id as string);
    people.set(profile.id as string, {
      role: roleOf(profile.role as string | null),
      isTest: Boolean(profile.is_test),
      online: online.get(profile.id as string) ?? false,
      smsEnabled: enabled.get(profile.id as string) ?? false,
      optedOut: Boolean(consent?.opted_out_at),
      hasConsent: Boolean(consent) && !consent?.opted_out_at,
      phone: phones.get(profile.id as string) ?? null,
    });
  }
  return people;
}

async function loadJobs(supabase: ServiceClient, ids: string[]): Promise<Map<string, JobRow>> {
  const unique = [...new Set(ids)];
  const jobs = new Map<string, JobRow>();
  if (unique.length === 0) return jobs;
  const { data } = await supabase
    .from("jobs")
    .select("id, service, pickup_area, preferred_date, pricing_method, offer_cents, driver_pay_cents, is_test, status, customer_id, assigned_driver_id, created_at")
    .in("id", unique);
  for (const row of data ?? []) jobs.set(row.id as string, row as JobRow);
  return jobs;
}

function toNotice(
  row: { id: string; profile_id: string; job_id: string | null; kind: string; created_at: string },
  person: Person | undefined,
  job: JobRow | undefined,
  platformBps: number,
): BookingNotice | null {
  if (!person || !job) return null;
  const earnings = knownDriverEarnings({
    pricingMethod: job.pricing_method,
    offerCents: job.offer_cents,
    driverPayCents: job.driver_pay_cents,
    platformBps,
  });
  return {
    id: row.id,
    profileId: row.profile_id,
    jobId: row.job_id,
    kind: row.kind,
    role: person.role,
    isTest: person.isTest,
    jobIsTest: job.is_test,
    online: person.online,
    smsEnabled: person.smsEnabled,
    optedOut: person.optedOut,
    hasConsent: person.hasConsent,
    phone: person.phone,
    service: job.service,
    city: cityFromArea(job.pickup_area),
    urgency: job.preferred_date ?? "",
    priceCents: job.offer_cents,
    earningsCents: earnings,
    createdAt: row.created_at,
    checkedAt: null,
  };
}

function createIo(supabase: ServiceClient): TransactionalIo {
  let cached: TransactionalSettings | null = null;
  return {
    async settings() {
      if (cached) return cached;
      const [{ data, error }, { data: privateSettings }] = await Promise.all([
        supabase
          .from("platform_settings")
          .select("transactional_sms_enabled_at, driver_job_sms_audience, sms_enabled, platform_bps, transactional_pilot_only")
          .eq("id", 1)
          .single(),
        supabase.from("booking_text_private").select("admin_alert_phone, pilot_profile_ids").eq("id", 1).maybeSingle(),
      ]);
      if (error || !data) throw new Error("transactional settings unavailable");
      const audience = audiences.has(data.driver_job_sms_audience as AudienceMode)
        ? (data.driver_job_sms_audience as AudienceMode)
        : "eligible";
      cached = {
        enabledAt: (data.transactional_sms_enabled_at as string | null) ?? null,
        audience,
        adminPhone: (privateSettings?.admin_alert_phone as string | null) ?? null,
        platformSms: Boolean(data.sms_enabled),
        platformBps: Number(data.platform_bps ?? 1500),
        site: publicSiteUrl(),
        pilotOnly: data.transactional_pilot_only !== false,
        pilotProfileIds: ((privateSettings?.pilot_profile_ids ?? []) as string[]).filter(Boolean),
      };
      return cached;
    },
    async notices(enabledAt) {
      const { data } = await supabase
        .from("notifications")
        .select("id, profile_id, job_id, kind, created_at")
        .gte("created_at", enabledAt)
        .is("transactional_checked_at", null)
        .not("job_id", "is", null)
        .order("created_at", { ascending: true })
        .limit(40);
      const rows = data ?? [];
      const [people, jobs] = await Promise.all([
        loadPeople(supabase, rows.map((row) => row.profile_id as string)),
        loadJobs(supabase, rows.map((row) => row.job_id as string)),
      ]);
      const current = await this.settings();
      return rows.flatMap((row) => {
        const notice = toNotice(
          row as { id: string; profile_id: string; job_id: string | null; kind: string; created_at: string },
          people.get(row.profile_id as string),
          jobs.get(row.job_id as string),
          current.platformBps,
        );
        return notice ? [notice] : [];
      });
    },
    async timers(enabledAt, now) {
      const current = await this.settings();
      const plans: PlannedSms[] = [];
      const offerCutoff = new Date(now.getTime() - 15 * 60_000).toISOString();
      const { data: openJobs } = await supabase
        .from("jobs")
        .select("id, service, pickup_area, preferred_date, pricing_method, offer_cents, driver_pay_cents, is_test, status, customer_id, assigned_driver_id, created_at")
        .eq("status", "open")
        .eq("preferred_date", "asap")
        .eq("is_test", false)
        .gte("created_at", enabledAt)
        .lte("created_at", offerCutoff)
        .limit(20);
      const openIds = (openJobs ?? []).map((row) => row.id as string);
      const offerCounts = new Map<string, number>();
      if (openIds.length > 0) {
        const { data: offers } = await supabase.from("job_offers").select("job_id").in("job_id", openIds);
        for (const offer of offers ?? []) {
          const id = offer.job_id as string;
          offerCounts.set(id, (offerCounts.get(id) ?? 0) + 1);
        }
      }
      for (const row of openJobs ?? []) {
        const job = row as JobRow;
        const plan = planNoOffer(
          {
            id: job.id,
            isTest: job.is_test,
            status: job.status,
            urgency: job.preferred_date ?? "",
            service: job.service,
            city: cityFromArea(job.pickup_area),
            priceCents: job.offer_cents,
            createdAt: job.created_at,
            authorizedAt: null,
            acknowledged: false,
            offerCount: offerCounts.get(job.id) ?? 0,
            driverId: null,
            driver: null,
          },
          current,
          now,
        );
        if (plan) plans.push(plan);
      }

      const { data: assigned } = await supabase
        .from("jobs")
        .select("id, service, pickup_area, preferred_date, pricing_method, offer_cents, driver_pay_cents, is_test, status, customer_id, assigned_driver_id, created_at")
        .eq("status", "assigned")
        .eq("preferred_date", "asap")
        .eq("is_test", false)
        .in("payment_status", ["authorized", "paid", "captured"])
        .limit(20);
      const assignedRows = (assigned ?? []) as JobRow[];
      const assignedIds = assignedRows.map((row) => row.id);
      const events = new Map<string, { authorizedAt: string | null; acknowledged: boolean }>();
      if (assignedIds.length > 0) {
        const { data: eventRows } = await supabase
          .from("job_events")
          .select("job_id, type, created_at")
          .in("job_id", assignedIds)
          .in("type", ["payment_authorized", "driver_acknowledged"]);
        for (const event of eventRows ?? []) {
          const currentEvent = events.get(event.job_id as string) ?? { authorizedAt: null, acknowledged: false };
          if (event.type === "driver_acknowledged") currentEvent.acknowledged = true;
          if (event.type === "payment_authorized" && (!currentEvent.authorizedAt || String(event.created_at) > currentEvent.authorizedAt)) {
            currentEvent.authorizedAt = String(event.created_at);
          }
          events.set(event.job_id as string, currentEvent);
        }
      }
      const drivers = await loadPeople(
        supabase,
        assignedRows.map((row) => row.assigned_driver_id).filter((id): id is string => Boolean(id)),
      );
      for (const row of assignedRows) {
        const event = events.get(row.id);
        if (!event?.authorizedAt || event.authorizedAt < enabledAt) continue;
        const person = row.assigned_driver_id ? drivers.get(row.assigned_driver_id) : undefined;
        const timer: TimerJob = {
          id: row.id,
          isTest: row.is_test,
          status: row.status,
          urgency: row.preferred_date ?? "",
          service: row.service,
          city: cityFromArea(row.pickup_area),
          priceCents: row.offer_cents,
          createdAt: row.created_at,
          authorizedAt: event.authorizedAt,
          acknowledged: event.acknowledged,
          offerCount: 1,
          driverId: row.assigned_driver_id,
          driver: person
            ? {
                isTest: person.isTest,
                online: person.online,
                smsEnabled: person.smsEnabled,
                optedOut: person.optedOut,
                hasConsent: person.hasConsent,
                phone: person.phone,
              }
            : null,
        };
        const reminder = planAckReminder(timer, current, now);
        const admin = planAdminAck(timer, current, now);
        if (reminder) plans.push(reminder);
        if (admin) plans.push(admin);
      }
      const { data: freshJobs } = await supabase
        .from("jobs")
        .select("id, service, pickup_area, preferred_date, pricing_method, offer_cents, driver_pay_cents, is_test, status, customer_id, assigned_driver_id, created_at")
        .eq("status", "open")
        .eq("is_test", false)
        .gte("created_at", enabledAt)
        .limit(20);
      for (const row of (freshJobs ?? []) as JobRow[]) {
        const { data: driverRows, error: driverError } = await supabase.rpc("transactional_job_drivers", { target_job: row.id });
        if (driverError) continue;
        const ids = ((driverRows ?? []) as { profile_id: string }[]).map((item) => item.profile_id);
        const keys = ids.map((id: string) => `sms:new_job:${row.id}:${id}`);
        const { data: existing } = keys.length
          ? await supabase.from("transactional_sms").select("dedupe_key").in("dedupe_key", keys)
          : { data: [] };
        const done = new Set((existing ?? []).map((item) => item.dedupe_key as string));
        const pending = ids.filter((id: string) => !done.has(`sms:new_job:${row.id}:${id}`));
        const people = await loadPeople(supabase, pending);
        for (const id of pending) {
          const person = people.get(id);
          if (!person) continue;
          const notice: BookingNotice = {
            id: `new-job:${row.id}:${id}`,
            profileId: id,
            jobId: row.id,
            kind: "new_job",
            role: "driver",
            isTest: person.isTest,
            jobIsTest: row.is_test,
            online: person.online,
            smsEnabled: person.smsEnabled,
            optedOut: person.optedOut,
            hasConsent: person.hasConsent,
            phone: person.phone,
            service: row.service,
            city: cityFromArea(row.pickup_area),
            urgency: row.preferred_date ?? "",
            priceCents: row.offer_cents,
            earningsCents: knownDriverEarnings({
              pricingMethod: row.pricing_method,
              offerCents: row.offer_cents,
              driverPayCents: row.driver_pay_cents,
              platformBps: current.platformBps,
            }),
            createdAt: row.created_at,
            checkedAt: null,
          };
          for (const plan of planLifecycle(notice, current)) {
            plans.push({ ...plan, sourceId: null });
          }
        }
      }
      return plans;
    },
    async claim(plan) {
      const { data: existing } = await supabase
        .from("transactional_sms")
        .select("id, status, claimed_at")
        .eq("dedupe_key", plan.dedupeKey)
        .maybeSingle();
      if (existing) {
        if (existing.claimed_at != null || existing.status !== "queued") return false;
        const patch =
          plan.status === "skipped"
            ? { status: "skipped", skip_reason: plan.reason, claimed_at: new Date().toISOString() }
            : { claimed_at: new Date().toISOString(), attempt_count: 1 };
        const { data } = await supabase
          .from("transactional_sms")
          .update(patch)
          .eq("id", existing.id)
          .is("claimed_at", null)
          .select("id");
        return Array.isArray(data) && data.length > 0;
      }
      const { data, error } = await supabase.rpc("claim_transactional_sms", {
        target_key: plan.dedupeKey,
        target_profile: plan.profileId,
        target_job: plan.jobId,
        target_kind: plan.kind,
        target_body: plan.body,
        target_phone: plan.phone,
        target_status: plan.status,
        target_reason: plan.reason,
        target_notification: plan.sourceId,
      });
      if (error) throw new Error("claim failed");
      return Boolean(data);
    },
    async send(phone, body) {
      const result = await sendTransactionalSms(phone, body);
      return { ok: result.ok, sid: result.sid, error: result.errorCode, outcome: result.outcome };
    },
    async mark(dedupeKey, status, sid, error) {
      const { error: updateError } = await supabase.rpc("finish_transactional_sms", {
        target_key: dedupeKey,
        target_status: status,
        target_sid: sid,
        target_error: error,
      });
      if (updateError) throw new Error("status update failed");
    },
    async started(dedupeKey) {
      await supabase.rpc("mark_transactional_send_started", { target_key: dedupeKey });
    },
    async retries() {
      const { data } = await supabase.rpc("reclaim_transactional_sms");
      return ((data ?? []) as {
        dedupe_key: string;
        profile_id: string | null;
        job_id: string | null;
        kind: string;
        body: string;
        to_phone: string | null;
        attempt_count: number;
      }[]).map((row) => ({
        dedupeKey: row.dedupe_key,
        sourceId: null,
        profileId: row.profile_id,
        jobId: row.job_id,
        kind: row.kind,
        body: row.body,
        phone: row.to_phone,
        status: "queued" as const,
        reason: null,
        attempt: row.attempt_count,
        alreadyClaimed: true,
      }));
    },
    async checked(noticeId) {
      await supabase.from("notifications").update({ transactional_checked_at: new Date().toISOString() }).eq("id", noticeId);
    },
    async suspendUnsent() {
      await supabase
        .from("transactional_sms")
        .update({ status: "skipped", skip_reason: "texts_disabled", retryable: false })
        .eq("status", "queued")
        .is("provider_sid", null);
    },
    async pending() {
      const { data } = await supabase
        .from("transactional_sms")
        .select("dedupe_key, profile_id, job_id, kind, body, to_phone")
        .eq("status", "queued")
        .is("claimed_at", null)
        .is("provider_sid", null)
        .order("created_at", { ascending: true })
        .limit(200);
      return (data ?? []).map((row) => ({
        dedupeKey: row.dedupe_key as string,
        sourceId: null,
        profileId: (row.profile_id as string | null) ?? null,
        jobId: (row.job_id as string | null) ?? null,
        kind: row.kind as string,
        body: row.body as string,
        phone: (row.to_phone as string | null) ?? null,
        status: "queued" as const,
        reason: null,
      }));
    },
    async jobOpen(jobId) {
      const { data } = await supabase
        .from("jobs")
        .select("status, assigned_driver_id, paused_at")
        .eq("id", jobId)
        .maybeSingle();
      return Boolean(data && data.status === "open" && data.assigned_driver_id == null && data.paused_at == null);
    },
    async lastBulkSentAt() {
      const { data } = await supabase
        .from("transactional_sms")
        .select("send_started_at")
        .in("kind", ["new_job", "admin_followup"])
        .not("send_started_at", "is", null)
        .order("send_started_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data?.send_started_at ? Date.parse(String(data.send_started_at)) : null;
    },
  };
}

function continueDrain(): void {
  const secret = process.env.CRON_SECRET;
  const site = publicSiteUrl();
  if (!secret || !site) return;
  try {
    after(() => {
      void fetch(`${site}/api/notifications/drain`, {
        method: "POST",
        headers: { authorization: `Bearer ${secret}` },
        cache: "no-store",
      }).catch(() => undefined);
    });
  } catch {
    // The five-minute text job starts another pass.
  }
}

/** Sends booking texts that are waiting. A full driver list continues immediately instead of waiting for the next schedule. */
export async function flushTransactionalSms(): Promise<{ sent: number; skipped: number; failed: number }> {
  try {
    const result = await runTransactionalPass(createIo(createServiceClient()), new Date());
    if (result.remaining && result.sent + result.skipped > 0) continueDrain();
    return { sent: result.sent, skipped: result.skipped, failed: result.failed };
  } catch {
    return { sent: 0, skipped: 0, failed: 0 };
  }
}

/** One extra text to each eligible driver on an open request. It does not reuse the first new-job key. */
export async function queueDriverFollowup(jobId: string): Promise<{ sent: number; waiting: number } | { error: string }> {
  const supabase = createServiceClient();
  const io = createIo(supabase);
  const settings = await io.settings();
  if (!settings.enabledAt) return { error: "Booking texts are off." };
  const now = new Date();
  const { count: recent } = await supabase
    .from("transactional_sms")
    .select("id", { count: "exact", head: true })
    .eq("job_id", jobId)
    .eq("kind", "admin_followup")
    .gte("created_at", followupWindowStart(now));
  if ((recent ?? 0) > 0) {
    return { error: "A follow-up already went out for this request. Wait 15 minutes before another." };
  }
  const jobs = await loadJobs(supabase, [jobId]);
  const job = jobs.get(jobId);
  if (!job || job.status !== "open") return { error: "This request is not open." };
  if (job.is_test) return { error: "Test requests are not texted." };
  const { data: driverRows, error: driverError } = await supabase.rpc("transactional_job_drivers", { target_job: jobId });
  if (driverError) return { error: "Eligible drivers could not be loaded." };
  const ids = ((driverRows ?? []) as { profile_id: string }[]).map((item) => item.profile_id);
  const people = await loadPeople(supabase, ids);
  const windowId = followupWindow(now);
  const plans = ids.flatMap((id) => {
    const person = people.get(id);
    if (!person) return [];
    const notice: BookingNotice = {
      id: `followup:${jobId}:${id}`,
      profileId: id,
      jobId,
      kind: "new_job",
      role: "driver",
      isTest: person.isTest,
      jobIsTest: job.is_test,
      online: person.online,
      smsEnabled: person.smsEnabled,
      optedOut: person.optedOut,
      hasConsent: person.hasConsent,
      phone: person.phone,
      service: job.service,
      city: cityFromArea(job.pickup_area),
      urgency: job.preferred_date ?? "",
      priceCents: job.offer_cents,
      earningsCents: knownDriverEarnings({
        pricingMethod: job.pricing_method,
        offerCents: job.offer_cents,
        driverPayCents: job.driver_pay_cents,
        platformBps: settings.platformBps,
      }),
      createdAt: job.created_at,
      checkedAt: null,
    };
    const plan = planFollowup(notice, settings, windowId);
    return plan ? [plan] : [];
  });
  const queued = plans.filter((plan) => plan.status === "queued");
  if (queued.length === 0) {
    return { error: "No eligible driver can be texted. The pilot list, consent, and preferences still apply." };
  }
  await deliverPlans(io, plans.filter((plan) => plan.status === "skipped"));
  for (const plan of queued) {
    const { error: insertError } = await supabase.from("transactional_sms").insert({
      dedupe_key: plan.dedupeKey,
      profile_id: plan.profileId,
      job_id: plan.jobId,
      kind: plan.kind,
      body: plan.body,
      to_phone: plan.phone,
      status: "queued",
      claimed_at: null,
      attempt_count: 0,
    });
    if (insertError && insertError.code !== "23505") return { error: "The follow-up could not be queued." };
  }
  const drained = await flushTransactionalSms();
  return { sent: drained.sent, waiting: Math.max(0, queued.length - drained.sent) };
}
