import "server-only";

import { sendEmail } from "@/lib/email";
import { channelPlan, externalDeliveryAllowed } from "@/lib/notifications/channels";
import { pilotSmsText } from "@/lib/notifications/sms-copy";
import { sendPush } from "@/lib/push";
import { sendSms } from "@/lib/sms";
import { createServiceClient } from "@/lib/supabase/service";

type AlertRow = {
  id: string;
  profile_id: string;
  job_id: string | null;
  kind: string;
  title: string;
  body: string;
  href: string;
  push_sent_at: string | null;
  email_sent_at: string | null;
  sms_sent_at: string | null;
};

/** Delivers alerts created by the database. Ordinary pages never call this. */
export async function deliverPendingAlerts(): Promise<number> {
  const supabase = createServiceClient();
  const { data: settings } = await supabase
    .from("platform_settings")
    .select("sms_enabled")
    .eq("id", 1)
    .maybeSingle();
  const { data: rows } = await supabase
    .from("notifications")
    .select("id, profile_id, job_id, kind, title, body, href, push_sent_at, email_sent_at, sms_sent_at")
    .or("push_sent_at.is.null,email_sent_at.is.null,sms_sent_at.is.null")
    .order("created_at", { ascending: true })
    .limit(50);

  let delivered = 0;
  for (const row of (rows ?? []) as AlertRow[]) {
    const changed = await deliverOne(row, Boolean(settings?.sms_enabled));
    if (changed) delivered += 1;
  }
  return delivered;
}

async function deliverOne(row: AlertRow, platformSms: boolean): Promise<boolean> {
  const supabase = createServiceClient();
  const { data: profile } = await supabase.from("profiles").select("is_test").eq("id", row.profile_id).maybeSingle();
  if (!externalDeliveryAllowed(profile?.is_test === true)) {
    const now = new Date().toISOString();
    const patch: Record<string, string> = {};
    if (row.push_sent_at == null) patch.push_sent_at = now;
    if (row.email_sent_at == null) patch.email_sent_at = now;
    if (row.sms_sent_at == null) patch.sms_sent_at = now;
    if (Object.keys(patch).length === 0) return false;
    await supabase.from("notifications").update(patch).eq("id", row.id);
    return true;
  }
  const [{ data: prefs }, { data: subscriptions }, { data: consent }, userResult] = await Promise.all([
    supabase
      .from("notification_preferences")
      .select("push_enabled, email_enabled, sms_enabled")
      .eq("profile_id", row.profile_id)
      .maybeSingle(),
    supabase.from("push_subscriptions").select("endpoint, p256dh, auth").eq("profile_id", row.profile_id),
    supabase
      .from("sms_consents")
      .select("opted_out_at")
      .eq("profile_id", row.profile_id)
      .order("consented_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.auth.admin.getUserById(row.profile_id),
  ]);
  const hasConsent = consent != null && consent.opted_out_at == null;
  const email = userResult.data.user?.email ?? "";
  const phone = userResult.data.user?.phone ?? "";
  const plan = channelPlan({
    platformSms,
    pushEnabled: prefs?.push_enabled ?? true,
    emailEnabled: prefs?.email_enabled ?? true,
    smsEnabled: prefs?.sms_enabled ?? false,
    hasSubscription: (subscriptions ?? []).length > 0,
    hasEmail: email.includes("@"),
    hasPhone: phone.startsWith("+"),
    hasPushKey: Boolean(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY),
    hasEmailKey: Boolean(process.env.RESEND_API_KEY && process.env.RESEND_FROM),
    hasSmsKey: Boolean(
      process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM_NUMBER,
    ),
    hasConsent,
    pushSent: row.push_sent_at != null,
    emailSent: row.email_sent_at != null,
    smsSent: row.sms_sent_at != null,
  });

  const patch: Record<string, string> = {};
  const now = new Date().toISOString();
  if (plan.push === "skip") patch.push_sent_at = now;
  if (plan.email === "skip") patch.email_sent_at = now;
  if (plan.sms === "skip") patch.sms_sent_at = now;

  if (plan.push === "send") {
    let sent = false;
    for (const subscription of subscriptions ?? []) {
      sent =
        (await sendPush(subscription, { title: row.title, body: row.body, href: row.href })) || sent;
    }
    if (sent) patch.push_sent_at = now;
  }
  if (plan.email === "send") {
    const sent = await sendEmail(email, row.title, `${row.body}\n\nOpen Pickuply to see the update.`);
    if (sent) patch.email_sent_at = now;
  }
  if (plan.sms === "send" && platformSms) {
    const text = await pilotText(supabase, row);
    if (!text) {
      patch.sms_sent_at = now;
    } else {
      let sent = false;
      try {
        sent = await sendSms(phone, text);
      } catch {
        sent = false;
      }
      if (sent) patch.sms_sent_at = now;
    }
  }

  if (Object.keys(patch).length === 0) return false;
  await supabase.from("notifications").update(patch).eq("id", row.id);
  return true;
}

async function pilotText(
  supabase: ReturnType<typeof createServiceClient>,
  row: AlertRow,
): Promise<string | null> {
  if (row.kind === "driver_approved") {
    const { data } = await supabase
      .from("drivers")
      .select("status")
      .eq("profile_id", row.profile_id)
      .maybeSingle();
    return pilotSmsText({ kind: row.kind, driverStatus: data?.status ?? null });
  }
  if (!row.job_id) return null;
  const { data } = await supabase
    .from("jobs")
    .select("status, pickup_area, service")
    .eq("id", row.job_id)
    .maybeSingle();
  return pilotSmsText({
    kind: row.kind,
    area: data?.pickup_area ?? null,
    service: data?.service ?? null,
    jobStatus: data?.status ?? null,
  });
}
