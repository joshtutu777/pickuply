import "server-only";

import { publicSiteUrl } from "@/lib/blog/site";
import { smsSegments } from "@/lib/communications/sms";
import { sendAdminSms } from "@/lib/sms";
import { runSmsDispatch, type DispatchCampaign, type DispatchIo, type SmsAudience } from "@/lib/sms/center";
import { createServiceClient } from "@/lib/supabase/service";

function statusCallback(): string | undefined {
  const site = publicSiteUrl();
  if (!site.startsWith("https://")) return undefined;
  return `${site}/api/twilio/status`;
}

function audience(value: unknown): SmsAudience {
  const record = value && typeof value === "object" ? (value as { kind?: string; ids?: string[]; phone?: string }) : {};
  if (record.kind === "phone" && record.phone) return { kind: "phone", phone: record.phone };
  if (record.kind === "person" && Array.isArray(record.ids)) return { kind: "person", ids: record.ids };
  if (record.kind === "selected" && Array.isArray(record.ids)) return { kind: "selected", ids: record.ids };
  if (record.kind === "customers" || record.kind === "drivers" || record.kind === "online_drivers") return { kind: record.kind };
  return { kind: "person", ids: [] };
}

/** Sends due admin texts. A second run claims nothing that the first run already took. */
export async function dispatchDueSms(now = new Date()): Promise<{ campaigns: number; sent: number }> {
  const supabase = createServiceClient();
  const io: DispatchIo = {
    async claim() {
      const { data, error } = await supabase.rpc("claim_due_sms_campaign");
      if (error || !data) return null;
      const row = data as { id: string; purpose: "promotional" | "operational"; body: string; audience: unknown; laneTest: boolean };
      const campaign: DispatchCampaign = {
        id: row.id,
        purpose: row.purpose,
        body: row.body,
        audience: audience(row.audience),
        laneTest: row.laneTest === true,
      };
      return campaign;
    },
    async defer(id, sendAt) {
      await supabase.rpc("defer_sms_campaign", { target: id, send_at: sendAt.toISOString() });
    },
    async recipients(campaign) {
      const { data, error } = await supabase.rpc("sms_campaign_recipients", { target: campaign.id });
      if (error || !data) return [];
      return (data as Array<Record<string, unknown>>).map((row) => ({
        phone: String(row.phone ?? ""),
        profileId: row.profile_id ? String(row.profile_id) : null,
        optedOut: row.opted_out === true,
        isTest: row.is_test === true,
        laneTest: campaign.laneTest,
        promotional: row.promotional === true,
        smsEnabled: row.sms_enabled === true,
        suspended: row.suspended === true,
        role: String(row.role ?? ""),
        driverEligible: row.driver_eligible === true,
        online: row.is_online === true,
      }));
    },
    async reserve(campaign, phone, profileId) {
      const { data, error } = await supabase.rpc("reserve_sms_message", {
        target_campaign: campaign.id,
        target_profile: profileId,
        target_phone: phone,
        body: campaign.body,
        segment_count: smsSegments(campaign.body),
      });
      if (error || !data) return null;
      return String(data);
    },
    async mark(id, deliveryStatus, sid, failure) {
      await supabase.rpc("finish_sms_provider", {
        target_message: id,
        next_status: deliveryStatus,
        provider_sid: sid,
        failure_reason: failure,
      });
    },
    async finish(id, counts) {
      await supabase.rpc("finish_sms_campaign", {
        target: id,
        sent_count: counts.sent,
        failed_count: counts.failed,
        skipped_count: counts.skipped,
      });
    },
    async send(phone, body) {
      const result = await sendAdminSms(phone, body, statusCallback());
      return { ok: result.ok, sid: result.sid };
    },
  };
  return runSmsDispatch(io, now);
}
