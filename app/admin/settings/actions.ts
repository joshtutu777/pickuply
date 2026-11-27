"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth/session";
import { parseDollarsToCents } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";

export async function saveOfferMinimums(formData: FormData) {
  await requireAdmin("/admin/settings");
  const delivery = parseDollarsToCents(String(formData.get("deliveryMin") ?? ""));
  const junk = parseDollarsToCents(String(formData.get("junkMin") ?? ""));
  const store = parseDollarsToCents(String(formData.get("storeMin") ?? ""));
  const freeItem = parseDollarsToCents(String(formData.get("freeItemMin") ?? ""));
  if (delivery == null || junk == null || store == null || freeItem == null) {
    redirect("/admin/settings?error=Enter%20each%20minimum%20offer%20in%20dollars");
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("update_offer_minimums", {
    delivery_cents: delivery,
    junk_cents: junk,
    store_cents: store,
    free_item_cents: freeItem,
  });
  revalidatePath("/admin/settings");
  redirect(error ? "/admin/settings?error=Could%20not%20save%20minimum%20offers" : "/admin/settings?saved=1");
}

export async function saveWavesSetting(formData: FormData) {
  await requireAdmin("/admin/settings");
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_waves_enabled", {
    enabled: formData.get("wavesEnabled") === "on",
  });
  revalidatePath("/admin/settings");
  redirect(error ? "/admin/settings?error=Could%20not%20save%20waves" : "/admin/settings?saved=1");
}

export async function saveSmsSetting(formData: FormData) {
  await requireAdmin("/admin/settings");
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_sms_enabled", {
    enabled: formData.get("smsEnabled") === "on",
  });
  revalidatePath("/admin/settings");
  redirect(error ? "/admin/settings?error=Could%20not%20save%20text%20messages" : "/admin/settings?saved=1");
}

export async function saveTransactionalAlerts(formData: FormData) {
  await requireAdmin("/admin/settings");
  const audience = String(formData.get("audience") ?? "");
  if (audience !== "eligible" && audience !== "online" && audience !== "off") {
    redirect("/admin/settings?error=Choose%20who%20receives%20new-job%20texts");
  }
  const pilotIds = String(formData.get("pilotIds") ?? "")
    .split(/[\s,]+/)
    .map((value) => value.trim())
    .filter(Boolean);
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (pilotIds.some((id) => !uuid.test(id))) {
    redirect("/admin/settings?error=Enter%20profile%20ids%20for%20the%20pilot%20list");
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_transactional_alerts", {
    phone: String(formData.get("adminPhone") ?? ""),
    audience,
    turn_on: formData.get("transactionalOn") === "on",
    pilot_only: formData.get("pilotOnly") === "on",
    pilot_ids: pilotIds,
  });
  revalidatePath("/admin/settings");
  redirect(error ? "/admin/settings?error=Could%20not%20save%20booking%20texts" : "/admin/settings?saved=1");
}

export async function saveSupportContact(formData: FormData) {
  await requireAdmin("/admin/settings");
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_support_contact", {
    phone: String(formData.get("supportPhone") ?? ""),
    email: String(formData.get("supportEmail") ?? ""),
  });
  revalidatePath("/admin/settings");
  revalidatePath("/support");
  redirect(error ? "/admin/settings?error=Could%20not%20save%20support%20contact" : "/admin/settings?saved=1");
}

export async function saveProofLocation(formData: FormData) {
  await requireAdmin("/admin/settings");
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_proof_location_enabled", {
    enabled: formData.get("proofLocation") === "on",
  });
  revalidatePath("/admin/settings");
  redirect(error ? "/admin/settings?error=Could%20not%20save%20proof%20location" : "/admin/settings?saved=1");
}
