"use server";

import { connection } from "next/server";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function createHelpRequest(formData: FormData) {
  await connection();
  const topic = String(formData.get("topic") ?? "");
  const body = String(formData.get("body") ?? "");
  const job = String(formData.get("job") ?? "");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_help_request", {
    topic,
    message_body: body,
    related_job: job || null,
  });
  if (error || !data) {
    redirect(`/help?error=${encodeURIComponent(error?.message ?? "Could not send that request")}`);
  }
  const photo = String(formData.get("photoPath") ?? "");
  if (photo) {
    await supabase.rpc("attach_help_photo", { target_request: data, photo_path: photo });
  }
  redirect(`/help/requests/${data}?sent=1`);
}

export async function replyHelpRequest(formData: FormData) {
  await connection();
  const id = String(formData.get("requestId") ?? "");
  const body = String(formData.get("body") ?? "");
  const supabase = await createClient();
  const { error } = await supabase.rpc("reply_help_request", { target_request: id, message_body: body });
  const back = String(formData.get("back") ?? `/help/requests/${id}`);
  redirect(error ? `${back}?error=${encodeURIComponent(error.message)}` : back);
}

export async function setHelpStatus(formData: FormData) {
  await connection();
  const id = String(formData.get("requestId") ?? "");
  const status = String(formData.get("status") ?? "");
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_help_status", { target_request: id, next_status: status });
  redirect(error ? `/admin/help/${id}?error=${encodeURIComponent(error.message)}` : `/admin/help/${id}`);
}
