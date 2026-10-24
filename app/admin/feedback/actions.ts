"use server";

import { connection } from "next/server";
import { redirect } from "next/navigation";
import { feedbackStatuses } from "@/lib/feedback";
import { createClient } from "@/lib/supabase/server";

export async function reviewFeedback(formData: FormData) {
  await connection();
  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("intent") ?? "") === "resolve" ? "resolved" : String(formData.get("status") ?? "");
  const notes = String(formData.get("notes") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id) || !feedbackStatuses.some((item) => item.id === status)) {
    redirect("/admin/feedback?error=save");
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("review_beta_feedback", {
    target_id: id,
    next_status: status,
    notes,
  });
  redirect(error ? `/admin/feedback/${id}?error=save` : `/admin/feedback/${id}?saved=1`);
}
