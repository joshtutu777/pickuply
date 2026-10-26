"use server";

import { redirect } from "next/navigation";
import { getOptionalSession } from "@/lib/auth/session";
import { sendEmail } from "@/lib/email";
import { parseSupportRequest } from "@/lib/support/ticket";
import { createClient } from "@/lib/supabase/server";

function text(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value : "";
}

export async function submitSupportRequest(form: FormData) {
  const parsed = parseSupportRequest({
    firstName: text(form, "firstName"),
    lastName: text(form, "lastName"),
    email: text(form, "email"),
    topic: text(form, "topic"),
    message: text(form, "message"),
    jobReference: text(form, "jobReference"),
    honeypot: text(form, "company"),
  });
  if (!parsed.ok) redirect(`/contact?error=${encodeURIComponent(parsed.error)}`);
  const jobValue = text(form, "jobId");
  const jobId = /^[0-9a-f-]{36}$/i.test(jobValue) ? jobValue : null;
  const supabase = await createClient();
  const saved = await supabase.rpc("create_support_ticket", {
    first_name: parsed.value.firstName,
    last_name: parsed.value.lastName,
    email: parsed.value.email,
    topic: parsed.value.topic,
    message: parsed.value.message,
    job_reference: parsed.value.jobReference,
    requested_job: jobId,
  });
  if (saved.error || !saved.data) {
    const message = saved.error?.message?.includes("already sent")
      ? "This message was already sent."
      : saved.error?.message?.includes("Too many")
        ? "Too many messages. Try again later."
        : "The message could not be sent.";
    redirect(`/contact?error=${encodeURIComponent(message)}`);
  }
  redirect(`/contact?sent=1&ref=${encodeURIComponent(String(saved.data))}`);
}

export async function replyToSupportTicket(form: FormData) {
  const session = await getOptionalSession();
  const id = text(form, "id");
  if (!session || !/^[0-9a-f-]{36}$/i.test(id)) redirect("/login?next=/contact");
  const message = text(form, "message").trim();
  if (!message) redirect(`/contact/tickets/${id}?error=reply`);
  const supabase = await createClient();
  const saved = await supabase.rpc("customer_support_reply", { ticket: id, message });
  if (saved.error) redirect(`/contact/tickets/${id}?error=reply`);
  redirect(`/contact/tickets/${id}?sent=1`);
}
