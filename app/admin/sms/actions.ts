"use server";

import { redirect } from "next/navigation";
import { optionalSmsBody, audienceFromForm, messagePreview, needsSendConfirm, operationalContentAllowed, scheduledInstant, smsPurposeFromForm } from "@/lib/sms/center";
import { dispatchDueSms } from "@/lib/sms/dispatch";
import { sendAdminSms } from "@/lib/sms";
import { requireAdmin } from "@/lib/auth/session";
import { formatUsPhone } from "@/lib/phone";
import { createClient } from "@/lib/supabase/server";
import { publicSiteUrl } from "@/lib/blog/site";

export type ComposeState = {
  error?: string;
  count?: number;
  names?: string[];
  segments?: number;
  cents?: number;
  rule?: string;
  needsConfirm?: boolean;
  deferred?: boolean;
} | null;

function safeError(message: string): string {
  const text = message.split("\n")[0] ?? "";
  if (text.includes("confirm send")) return "Check the box to confirm this text.";
  const allowed = [
    "Nobody eligible",
    "That same text",
    "Texting is turned off",
    "Choose a time",
    "over 1,000",
    "daily text limit",
    "bulk texts",
    "20 texts",
    "Start the text",
    "That reads as a promotion",
    "Schedule no more",
    "no longer waiting",
    "opted out",
    "admin lane",
    "was not found",
    "only an admin",
    "Choose an Eastern",
    "future time",
    "happens twice",
    "does not exist",
  ];
  if (allowed.some((item) => text.includes(item))) return text;
  return "That text could not be saved.";
}

export async function composeSms(_previous: ComposeState, formData: FormData): Promise<ComposeState> {
  await requireAdmin("/admin/sms/compose");
  const parsed = audienceFromForm(formData);
  if ("error" in parsed) return { error: parsed.error };
  const purpose = smsPurposeFromForm(formData);
  const draft = messagePreview(String(formData.get("body") ?? ""), 1);
  if (!("error" in draft) && purpose === "operational" && !operationalContentAllowed(draft.body)) {
    return { error: "That reads as a promotion. Choose promotional so promotional consent is required." };
  }
  if ("error" in draft) return { error: draft.error };
  const supabase = await createClient();
  const preview = await supabase.rpc("admin_sms_preview", { purpose, audience: parsed.audience });
  if (preview.error) return { error: safeError(preview.error.message) };
  const result = preview.data as { count?: number; names?: string[] } | null;
  const count = Number(result?.count ?? 0);
  const priced = messagePreview(String(formData.get("body") ?? ""), count);
  if ("error" in priced) return { error: priced.error };
  const state: ComposeState = {
    count,
    names: result?.names ?? [],
    segments: priced.segments,
    cents: priced.cents,
    needsConfirm: needsSendConfirm(count),
  };
  if (count === 0) {
    if (parsed.audience.kind === "person") {
      return { ...state, error: "That person would not receive this text. Optional alerts are off, they opted out, or they replied STOP." };
    }
    if (parsed.audience.kind === "phone") {
      return { ...state, error: "That number would not receive this text. Check that it is a US number and has not replied STOP." };
    }
    if (parsed.audience.kind === "selected") {
      return { ...state, error: "None of the selected people would receive this text. Optional alerts or STOP left them out." };
    }
    return { ...state, error: "Nobody eligible would receive this text." };
  }
  if (formData.get("intent") !== "send") return state;
  if (state.needsConfirm && formData.get("confirm") !== "yes") {
    return { ...state, error: "Check the box to confirm this text." };
  }
  const when = scheduledInstant(formData, new Date());
  if ("error" in when) return { ...state, error: when.error };
  const saved = await supabase.rpc("admin_save_sms_campaign", {
    purpose,
    body: priced.body,
    audience: parsed.audience,
    scheduled_for: when.at.toISOString(),
    confirmed: formData.get("confirm") === "yes",
  });
  if (saved.error) return { ...state, error: safeError(saved.error.message) };
  if (!when.deferred && when.at.getTime() <= Date.now() + 60_000) {
    try {
      await dispatchDueSms();
    } catch {
      redirect("/admin/sms/scheduled?saved=waiting");
    }
  }
  redirect(when.deferred || when.at.getTime() > Date.now() + 60_000 ? `/admin/sms/scheduled?saved=${when.deferred ? "morning" : "1"}` : "/admin/sms/sent?saved=1");
}

export async function cancelSmsCampaign(formData: FormData) {
  await requireAdmin("/admin/sms/scheduled");
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_cancel_sms_campaign", { target: String(formData.get("id") ?? "") });
  if (error) redirect(`/admin/sms/scheduled?error=${encodeURIComponent(safeError(error.message))}`);
  redirect("/admin/sms/scheduled?saved=cancelled");
}

export async function updateSmsCampaign(formData: FormData) {
  await requireAdmin("/admin/sms/scheduled");
  const when = scheduledInstant(formData, new Date());
  if ("error" in when) redirect(`/admin/sms/scheduled?error=${encodeURIComponent(when.error)}`);
  const body = optionalSmsBody(String(formData.get("body") ?? ""));
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_update_sms_campaign", {
    target: String(formData.get("id") ?? ""),
    body,
    scheduled_for: when.at.toISOString(),
  });
  if (error) redirect(`/admin/sms/scheduled?error=${encodeURIComponent(safeError(error.message))}`);
  redirect("/admin/sms/scheduled?saved=edited");
}

export async function replyToSms(formData: FormData) {
  const thread = String(formData.get("thread") ?? "");
  await requireAdmin(`/admin/sms/${thread}`);
  const body = optionalSmsBody(String(formData.get("body") ?? ""));
  const supabase = await createClient();
  const prepared = await supabase.rpc("admin_prepare_sms_reply", { target: thread, body });
  if (prepared.error) redirect(`/admin/sms/${thread}?error=${encodeURIComponent(safeError(prepared.error.message))}`);
  const row = prepared.data as { messageId?: string; phone?: string } | null;
  const site = publicSiteUrl();
  const callback = site.startsWith("https://") ? `${site}/api/twilio/status` : undefined;
  const sent = row?.phone ? await sendAdminSms(row.phone, body, callback) : { ok: false, sid: null, errorCode: null };
  await supabase.rpc("finish_sms_provider", {
    target_message: row?.messageId ?? "",
    next_status: sent.ok ? "accepted" : "failed",
    provider_sid: sent.sid,
    failure_reason: sent.ok ? null : sent.errorCode ?? "provider declined",
  });
  redirect(`/admin/sms/${thread}?saved=1`);
}

export type SmsPerson = {
  id: string;
  name: string;
  role: string;
  phone: string;
  note: string;
};

export async function searchSmsPeople(query: string): Promise<{ people: SmsPerson[]; error?: string }> {
  await requireAdmin("/admin/sms/compose");
  const supabase = await createClient();
  const found = await supabase.rpc("admin_sms_search", { query: query.trim() });
  if (found.error) return { people: [], error: "Search could not be completed." };
  const people = ((found.data ?? []) as Array<{
    profile_id: string;
    full_name: string;
    role: string;
    phone: string | null;
    sms_enabled: boolean;
    opted_out: boolean;
    suspended: boolean;
  }>).map((row) => ({
    id: row.profile_id,
    name: row.full_name,
    role: row.role,
    phone: formatUsPhone(row.phone ?? "") ?? "No US phone",
    note: row.opted_out ? "Replied STOP" : row.suspended ? "Suspended" : row.sms_enabled ? "Optional alerts on" : "Optional alerts off",
  }));
  return { people };
}
