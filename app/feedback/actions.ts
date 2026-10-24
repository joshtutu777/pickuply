"use server";

import { connection } from "next/server";
import { appVersion } from "@/lib/beta";
import { safeDeviceInfo, safePagePath, validateFeedback } from "@/lib/feedback";
import { createClient } from "@/lib/supabase/server";

export type FeedbackState = { error: string; done: boolean };

const shown = new Set([
  "Choose a feedback type.",
  "Subject must be 3 to 120 characters.",
  "Details must be 10 to 4000 characters.",
  "You already sent this feedback.",
  "Please wait before sending more feedback.",
  "sign in required",
]);

export async function submitFeedback(_previous: FeedbackState, formData: FormData): Promise<FeedbackState> {
  await connection();
  const type = String(formData.get("type") ?? "");
  const subject = String(formData.get("subject") ?? "");
  const details = String(formData.get("details") ?? "");
  const problem = validateFeedback({ type, subject, details });
  if (problem) return { error: problem, done: false };

  const supabase = await createClient();
  const { error } = await supabase.rpc("submit_beta_feedback", {
    kind: type,
    subject_text: subject.trim(),
    details: details.trim(),
    page_text: safePagePath(String(formData.get("page") ?? "")),
    version_text: appVersion(),
    device_text: safeDeviceInfo(String(formData.get("device") ?? "")),
  });
  if (error) {
    const message = shown.has(error.message) ? error.message : "Could not send feedback.";
    return { error: message, done: false };
  }
  return { error: "", done: true };
}
