import "server-only";

import { createClient } from "@/lib/supabase/server";

type ServerClient = Awaited<ReturnType<typeof createClient>>;

export async function loadTextChoice(supabase: ServerClient) {
  const [{ data: prefs }, { data: consent }, { data: settings }] = await Promise.all([
    supabase.from("notification_preferences").select("push_enabled, email_enabled, promotional_sms, sms_enabled").maybeSingle(),
    supabase.from("sms_consents").select("opted_out_at, consented_at").order("consented_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("platform_settings").select("sms_enabled, transactional_sms_enabled_at").eq("id", 1).maybeSingle(),
  ]);
  const optedOut = Boolean(consent?.opted_out_at);
  return {
    pushEnabled: prefs?.push_enabled ?? true,
    emailEnabled: prefs?.email_enabled ?? true,
    promotional: Boolean(prefs?.promotional_sms),
    textsAvailable: Boolean(settings?.sms_enabled) && Boolean(settings?.transactional_sms_enabled_at),
    optedOut,
    smsOptIn: Boolean(prefs?.sms_enabled) && !optedOut,
  };
}
