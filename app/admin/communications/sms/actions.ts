"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { parseSmsAudience } from "@/lib/communications/campaign";
import { resolveNyWall } from "@/lib/communications/sms";
import { requireAdmin } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export type SmsPreview = {
  phones: number;
  duplicatesRemoved: number;
  ineligible: number;
  unverified: number;
  optedOut: number;
  noMarketingConsent: number;
  noPhone: number;
  suspended: number;
};

function fail(message: string): never {
  redirect(`/admin/communications/sms?error=${encodeURIComponent(message)}`);
}

function audienceFrom(formData: FormData) {
  try {
    return parseSmsAudience({
      kind: String(formData.get("audience") ?? ""),
      ids: String(formData.get("ids") ?? ""),
      zips: String(formData.get("zips") ?? ""),
      cities: String(formData.get("cities") ?? ""),
      states: String(formData.get("states") ?? ""),
    });
  } catch (error) {
    fail(error instanceof Error ? error.message : "Check the audience.");
  }
}

function purposeFrom(formData: FormData): "promotional" | "account_support" {
  return formData.get("purpose") === "account_support" ? "account_support" : "promotional";
}

function whenFrom(formData: FormData): string | null {
  if (formData.get("sendNow") === "on") return null;
  const date = String(formData.get("date") ?? "");
  const time = String(formData.get("time") ?? "");
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const clock = /^(\d{2}):(\d{2})$/.exec(time);
  if (!match || !clock) fail("Choose an Eastern Time date and time, or send now.");
  const resolved = resolveNyWall(Number(match[1]), Number(match[2]), Number(match[3]), Number(clock[1]), Number(clock[2]));
  if ("error" in resolved) {
    fail(resolved.error === "ambiguous" ? "That Eastern Time happens twice. Pick 8:00 AM or later." : "That Eastern Time does not exist.");
  }
  return resolved.utc.toISOString();
}

function readPreview(value: unknown): SmsPreview | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const number = (key: string) => (typeof row[key] === "number" ? row[key] : Number(row[key] ?? 0));
  return {
    phones: number("phones"),
    duplicatesRemoved: number("duplicatesRemoved"),
    ineligible: number("ineligible"),
    unverified: number("unverified"),
    optedOut: number("optedOut"),
    noMarketingConsent: number("noMarketingConsent"),
    noPhone: number("noPhone"),
    suspended: number("suspended"),
  };
}

export async function previewSmsAudience(formData: FormData): Promise<{ preview?: SmsPreview; error?: string }> {
  await requireAdmin("/admin/communications/sms");
  let audience;
  try {
    audience = parseSmsAudience({
      kind: String(formData.get("audience") ?? ""),
      ids: String(formData.get("ids") ?? ""),
      zips: String(formData.get("zips") ?? ""),
      cities: String(formData.get("cities") ?? ""),
      states: String(formData.get("states") ?? ""),
    });
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Check the audience." };
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("sms_campaign_preview", {
    audience,
    purpose: purposeFrom(formData),
  });
  if (error) return { error: error.message };
  const preview = readPreview(data);
  if (!preview) return { error: "The audience preview did not come back." };
  return { preview };
}

export async function saveSmsCampaign(formData: FormData) {
  await requireAdmin("/admin/communications/sms");
  const supabase = await createClient();
  const { error } = await supabase.rpc("save_sms_campaign", {
    target: null,
    p_name: String(formData.get("name") ?? ""),
    p_body: String(formData.get("body") ?? ""),
    p_audience: audienceFrom(formData),
    p_purpose: purposeFrom(formData),
  });
  revalidatePath("/admin/communications/sms");
  if (error) fail(error.message);
  redirect("/admin/communications/sms?saved=draft");
}

export async function scheduleSmsCampaign(formData: FormData) {
  await requireAdmin("/admin/communications/sms");
  const supabase = await createClient();
  const saved = await supabase.rpc("save_sms_campaign", {
    target: null,
    p_name: String(formData.get("name") ?? ""),
    p_body: String(formData.get("body") ?? ""),
    p_audience: audienceFrom(formData),
    p_purpose: purposeFrom(formData),
  });
  if (saved.error || !saved.data) fail(saved.error?.message ?? "The draft could not be saved.");
  const scheduled = await supabase.rpc("schedule_sms_campaign", {
    target: saved.data,
    p_scheduled_for: whenFrom(formData),
  });
  revalidatePath("/admin/communications/sms");
  if (scheduled.error) fail(scheduled.error.message);
  redirect("/admin/communications/sms?saved=scheduled");
}

async function changeCampaign(formData: FormData, action: "pause_sms_campaign" | "cancel_sms_campaign") {
  await requireAdmin("/admin/communications/sms");
  const id = String(formData.get("id") ?? "");
  const supabase = await createClient();
  const { error } = await supabase.rpc(action, { target: id });
  revalidatePath("/admin/communications/sms");
  revalidatePath(`/admin/communications/sms/${id}`);
  if (error) fail(error.message);
  redirect(`/admin/communications/sms/${id}?saved=1`);
}

export async function pauseSmsCampaign(formData: FormData) {
  await changeCampaign(formData, "pause_sms_campaign");
}

export async function cancelSmsCampaign(formData: FormData) {
  await changeCampaign(formData, "cancel_sms_campaign");
}

export async function resumeSmsCampaign(formData: FormData) {
  await requireAdmin("/admin/communications/sms");
  const id = String(formData.get("id") ?? "");
  const supabase = await createClient();
  const { error } = await supabase.rpc("schedule_sms_campaign", { target: id, p_scheduled_for: null });
  revalidatePath("/admin/communications/sms");
  revalidatePath(`/admin/communications/sms/${id}`);
  if (error) fail(error.message);
  redirect(`/admin/communications/sms/${id}?saved=1`);
}
