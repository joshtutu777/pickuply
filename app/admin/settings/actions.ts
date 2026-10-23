"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

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
