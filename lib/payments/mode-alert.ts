import "server-only";

import { createServiceClient } from "@/lib/supabase/service";

/** In-app admin alert. Text, email, and push timestamps are set so this does not text anyone. */
export async function alertPaymentsIssue(dedupe: string, title: string, body: string): Promise<void> {
  const supabase = createServiceClient();
  const now = new Date().toISOString();
  const admins = await supabase.from("profiles").select("id").eq("role", "admin");
  let wrote = false;
  for (const admin of admins.data ?? []) {
    const inserted = await supabase.from("notifications").insert({
      profile_id: admin.id,
      job_id: null,
      kind: "payments_mode",
      title,
      body,
      href: "/admin/health",
      dedupe_key: dedupe,
      push_sent_at: now,
      email_sent_at: now,
      sms_sent_at: now,
    });
    if (!inserted.error) wrote = true;
  }
  if (!wrote) return;
  await supabase.from("audit_log").insert({
    actor_id: null,
    action: "payments_mode_mismatch",
    target_type: "platform_settings",
    target_id: null,
    data: { dedupe, title, note: body },
  });
}
