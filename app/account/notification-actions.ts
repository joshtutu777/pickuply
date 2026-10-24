"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSignedIn } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

function alertsPath(role: string): string {
  if (role === "driver") return "/driver/notifications";
  if (role === "admin") return "/admin/notifications";
  return "/account/notifications";
}

export async function saveAlertPreferences(formData: FormData) {
  const session = await requireSignedIn("/account/notifications");
  const supabase = await createClient();
  const { error } = await supabase.rpc("save_notification_preferences", {
    push_on: formData.get("push") === "on",
    email_on: formData.get("email") === "on",
    promotional_on: formData.get("promotional") === "on",
  });
  const path = alertsPath(session.role);
  revalidatePath(path);
  redirect(error ? `${path}?error=save` : `${path}?saved=1`);
}

export async function markAlertsRead() {
  const session = await requireSignedIn("/account/notifications");
  const supabase = await createClient();
  await supabase.rpc("mark_notifications_read");
  revalidatePath(alertsPath(session.role));
}

export async function dismissHomeScreenHint() {
  const session = await requireSignedIn("/account");
  const supabase = await createClient();
  await supabase.rpc("dismiss_home_screen_hint");
  revalidatePath("/account");
  revalidatePath("/driver");
  revalidatePath(alertsPath(session.role));
}
