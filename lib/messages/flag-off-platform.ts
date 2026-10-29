import "server-only";

import { createServiceClient } from "@/lib/supabase/service";

/** Records a blocked off-platform payment message. The second attempt alerts admins in the app only. */
export async function flagOffPlatformAttempt(profileId: string, threadId: string): Promise<void> {
  const supabase = createServiceClient();
  const prior = await supabase
    .from("audit_log")
    .select("id", { count: "exact", head: true })
    .eq("actor_id", profileId)
    .eq("action", "off_platform_payment");
  const count = prior.count ?? 0;
  await supabase.from("audit_log").insert({
    actor_id: profileId,
    action: "off_platform_payment",
    target_type: "message_threads",
    target_id: threadId,
    data: {},
  });
  if (count < 1) return;
  const now = new Date().toISOString();
  const admins = await supabase.from("profiles").select("id").eq("role", "admin");
  for (const admin of admins.data ?? []) {
    await supabase.from("notifications").insert({
      profile_id: admin.id,
      job_id: null,
      kind: "off_platform_payment",
      title: "Off-platform payment attempt",
      body: "A chat message tried to move payment off Pickuply more than once.",
      href: "/admin",
      dedupe_key: `off-platform:${profileId}:${count + 1}`,
      push_sent_at: now,
      email_sent_at: now,
      sms_sent_at: now,
    });
  }
}
