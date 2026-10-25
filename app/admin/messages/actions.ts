"use server";

import { connection } from "next/server";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function resolveSupportThread(formData: FormData) {
  await connection();
  const threadId = String(formData.get("threadId") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(threadId)) redirect("/admin/messages?error=That%20conversation%20was%20not%20found.");
  const supabase = await createClient();
  const { error } = await supabase.rpc("mark_support_resolved", { target_thread: threadId });
  if (error) {
    redirect(`/admin/messages/${threadId}?error=${encodeURIComponent(error.message)}`);
  }
  redirect(`/admin/messages/${threadId}`);
}

export async function startAdminMessage(formData: FormData) {
  await connection();
  const target = String(formData.get("profileId") ?? "");
  const note = String(formData.get("note") ?? "");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_start_message", {
    target_profile: target,
    message_body: note,
  });
  if (error || !data) {
    redirect(`/admin/messages?error=${encodeURIComponent(error?.message ?? "That message could not be sent.")}`);
  }
  redirect(`/admin/messages/${data}`);
}
