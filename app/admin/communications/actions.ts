"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { pushPayload } from "@/lib/communications/push";
import { resolveNyWall } from "@/lib/communications/sms";
import { requireAdmin } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

function fail(message: string): never {
  redirect(`/admin/communications?error=${encodeURIComponent(message)}`);
}

function audienceFrom(formData: FormData): { kind: string; ids?: string[]; city?: string; onlineOnly?: boolean } {
  const kind = String(formData.get("audience") ?? "");
  const allowed = ["individual", "selected", "customers", "drivers", "all", "online_drivers", "city_drivers", "active_customers"];
  if (!allowed.includes(kind)) fail("Choose an audience.");
  const ids = String(formData.get("ids") ?? "")
    .split(/[\s,]+/)
    .map((id) => id.trim())
    .filter(Boolean);
  if ((kind === "individual" || kind === "selected") && ids.length === 0) fail("Choose at least one person.");
  if (kind === "individual" && ids.length !== 1) fail("An individual announcement needs one person.");
  if (ids.some((id) => !/^[0-9a-f-]{36}$/i.test(id))) fail("A person id is not valid.");
  const city = String(formData.get("city") ?? "").trim();
  if (kind === "city_drivers" && city.length < 2) fail("Choose a city from Areas I Cover.");
  return {
    kind,
    ids: ids.length > 0 ? ids : undefined,
    city: city || undefined,
    onlineOnly: formData.get("onlineOnly") === "on",
  };
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

export async function createAnnouncement(formData: FormData) {
  await requireAdmin("/admin/communications");
  const title = String(formData.get("title") ?? "");
  const body = String(formData.get("body") ?? "");
  const href = String(formData.get("href") ?? "/account/notifications");
  const payload = pushPayload({ title, body, href, id: "draft" });
  if (!payload) fail("Use a public title, a short note, and a Pickuply page. Leave out phone numbers and payment details.");
  const channels = ["in_app", "push", "sms"].filter((channel) => formData.get(channel) === "on");
  if (channels.length === 0) fail("Choose at least one channel.");
  const purpose = formData.get("purpose") === "account_support" ? "account_support" : "promotional";
  const supabase = await createClient();
  const { error } = await supabase.rpc("create_admin_announcement", {
    p_title: payload.title,
    p_body: payload.body,
    p_href: payload.href,
    p_channels: channels,
    p_audience: audienceFrom(formData),
    p_purpose: purpose,
    p_scheduled_for: whenFrom(formData),
  });
  revalidatePath("/admin/communications");
  if (error) fail(error.message);
  redirect("/admin/communications?saved=1");
}

export async function cancelAnnouncement(formData: FormData) {
  await requireAdmin("/admin/communications");
  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_admin_announcement", { target: String(formData.get("id") ?? "") });
  revalidatePath("/admin/communications");
  if (error) fail(error.message);
  redirect("/admin/communications?saved=cancelled");
}

export async function updateAnnouncement(formData: FormData) {
  await requireAdmin("/admin/communications");
  const title = String(formData.get("title") ?? "");
  const body = String(formData.get("body") ?? "");
  const payload = pushPayload({ title, body, href: "/account/notifications", id: "draft" });
  if (!payload) fail("Use a public title and a short note.");
  const supabase = await createClient();
  const { error } = await supabase.rpc("update_admin_announcement", {
    target: String(formData.get("id") ?? ""),
    p_title: payload.title,
    p_body: payload.body,
    p_scheduled_for: whenFrom(formData),
  });
  revalidatePath("/admin/communications");
  if (error) fail(error.message);
  redirect("/admin/communications?saved=edited");
}
