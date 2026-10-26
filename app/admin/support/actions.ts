"use server";

import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth/session";
import { sendEmail } from "@/lib/email";
import { createClient } from "@/lib/supabase/server";

function text(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value : "";
}

export async function replyToTicket(form: FormData) {
  const session = await requireAdmin("/admin/support");
  const id = text(form, "id");
  const message = text(form, "message").trim();
  const note = text(form, "kind") === "internal";
  if (!/^[0-9a-f-]{36}$/i.test(id) || !message) redirect(`/admin/support/${id}?error=reply`);
  const supabase = await createClient();
  const ticket = await supabase.from("support_tickets").select("email, profile_id, reference, is_test").eq("id", id).maybeSingle();
  const saved = await supabase.rpc("admin_support_message", { ticket: id, message, note });
  if (saved.error || !ticket.data) redirect(`/admin/support/${id}?error=reply`);
  if (note || ticket.data.profile_id || ticket.data.is_test) redirect(`/admin/support/${id}?saved=1`);
  let sent = false;
  try {
    sent = await sendEmail(
      ticket.data.email,
      `Pickuply support ${ticket.data.reference}`,
      `${message}\n\nThis reply is about request ${ticket.data.reference}.`,
    );
  } catch {
    sent = false;
  }
  await supabase.from("audit_log").insert({
    actor_id: session.userId,
    action: sent ? "support_email_sent" : "support_email_not_sent",
    target_type: "support_ticket",
    target_id: id,
    data: { reference: ticket.data.reference },
  });
  redirect(`/admin/support/${id}?saved=1&email=${sent ? "sent" : "not-sent"}`);
}

export async function updateSupportTicket(form: FormData) {
  const session = await requireAdmin("/admin/support");
  const id = text(form, "id");
  const status = text(form, "status");
  const assign = text(form, "assign");
  if (!/^[0-9a-f-]{36}$/i.test(id)) redirect("/admin/support");
  if (!["open", "awaiting_customer", "resolved", "closed"].includes(status)) redirect(`/admin/support/${id}?error=status`);
  const supabase = await createClient();
  const assigned = assign === "me" ? session.userId : assign === "none" ? null : undefined;
  const patch: { status: string; assigned_admin_id?: string | null } = { status };
  if (assigned !== undefined) patch.assigned_admin_id = assigned;
  const saved = await supabase.from("support_tickets").update(patch).eq("id", id);
  if (saved.error) redirect(`/admin/support/${id}?error=status`);
  await supabase.from("audit_log").insert({
    actor_id: session.userId,
    action: "support_status",
    target_type: "support_ticket",
    target_id: id,
    data: { status },
  });
  redirect(`/admin/support/${id}?saved=1`);
}
