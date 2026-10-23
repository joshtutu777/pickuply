"use server";

import { connection } from "next/server";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

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
