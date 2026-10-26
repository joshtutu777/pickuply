import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { replyToTicket, updateSupportTicket } from "@/app/admin/support/actions";
import { LoadingMain } from "@/components/loading-main";
import { requireAdmin } from "@/lib/auth/session";
import { supportStatusLabel, supportTopicLabel } from "@/lib/support/ticket";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Support request" };

export default function AdminTicketPage({ params, searchParams }: PageProps<"/admin/support/[id]">) {
  return (
    <Suspense fallback={<LoadingMain />}>
      <AdminTicket params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function AdminTicket({
  params,
  searchParams,
}: {
  params: PageProps<"/admin/support/[id]">["params"];
  searchParams: PageProps<"/admin/support/[id]">["searchParams"];
}) {
  await requireAdmin("/admin/support");
  const { id } = await params;
  const query = await searchParams;
  const supabase = await createClient();
  const { data: ticket } = await supabase
    .from("support_tickets")
    .select("id, reference, first_name, last_name, email, topic, body, job_reference, job_id, profile_id, status, assigned_admin_id, is_test, created_at, updated_at")
    .eq("id", id)
    .maybeSingle();
  if (!ticket) notFound();
  const [{ data: messages }, { data: person }, { data: assignee }] = await Promise.all([
    supabase.from("support_ticket_messages").select("id, kind, body, created_at").eq("ticket_id", id).order("created_at", { ascending: true }),
    ticket.profile_id
      ? supabase.from("profiles").select("full_name, role").eq("id", ticket.profile_id).maybeSingle()
      : Promise.resolve({ data: null }),
    ticket.assigned_admin_id
      ? supabase.from("profiles").select("full_name").eq("id", ticket.assigned_admin_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const emailNote = query.email === "sent" ? "Reply saved and emailed." : query.email === "not-sent" ? "Reply saved. Email was not sent." : query.saved === "1" ? "Saved." : null;
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">
      <Link href="/admin/support" className="inline-flex min-h-12 items-center font-semibold text-brand">All requests</Link>
      <p className="mt-3 text-sm font-semibold tracking-wide text-brand uppercase">{ticket.reference}</p>
      <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight">{ticket.first_name} {ticket.last_name}</h1>
      <p className="mt-2 text-base">{ticket.email}</p>
      <p className="mt-1 text-base text-muted">{supportTopicLabel(ticket.topic)} · {supportStatusLabel(ticket.status)}{ticket.is_test ? " · Test" : ""}</p>
      {person ? <p className="mt-2 text-base">Account: {person.full_name} · {person.role}</p> : <p className="mt-2 text-base text-muted">No signed-in account was linked.</p>}
      {ticket.job_id ? <p className="mt-1 text-base">A job on this account was linked.</p> : null}
      {ticket.job_reference ? <p className="mt-1 text-base">Job reference: {ticket.job_reference}</p> : null}
      <p className="mt-2 text-base text-muted">Assigned: {assignee?.full_name ?? "Unassigned"}</p>
      <p className="mt-1 text-sm text-muted">Opened {ticket.created_at} · Updated {ticket.updated_at}</p>
      {emailNote ? <p role="status" className="mt-4 text-base">{emailNote}</p> : null}
      {query.error ? <p role="alert" className="mt-4 text-base text-danger">That change could not be saved.</p> : null}
      <ol className="mt-4 grid gap-3">
        {(messages ?? []).map((message) => (
          <li key={message.id} className="rounded-3xl bg-paper-raised p-4 ring-1 ring-line">
            <p className="text-sm font-semibold text-brand">{message.kind === "internal" ? "Internal note" : message.kind === "admin" ? "Support" : "Customer"}</p>
            <p className="mt-2 whitespace-pre-wrap text-base">{message.body}</p>
          </li>
        ))}
      </ol>
      <form action={replyToTicket} className="mt-4 grid gap-3">
        <input type="hidden" name="id" value={ticket.id} />
        <label className="grid gap-2 font-semibold">
          Message
          <textarea name="message" required rows={4} className="rounded-2xl border border-line bg-paper px-4 py-3 font-normal" />
        </label>
        <div className="flex flex-wrap gap-2">
          <button name="kind" value="reply" className="inline-flex min-h-12 items-center rounded-full bg-brand px-5 font-semibold text-white">Reply to customer</button>
          <button name="kind" value="internal" className="inline-flex min-h-12 items-center rounded-full bg-paper-raised px-5 font-semibold ring-1 ring-line">Add internal note</button>
        </div>
      </form>
      <form action={updateSupportTicket} className="mt-4 flex flex-wrap items-end gap-2">
        <input type="hidden" name="id" value={ticket.id} />
        <label className="grid gap-2 font-semibold">
          Status
          <select name="status" defaultValue={ticket.status} className="min-h-12 rounded-2xl border border-line bg-paper px-3">
            <option value="open">Open</option>
            <option value="awaiting_customer">Awaiting customer</option>
            <option value="resolved">Resolved</option>
            <option value="closed">Closed</option>
          </select>
        </label>
        <label className="grid gap-2 font-semibold">
          Assign
          <select name="assign" defaultValue="" className="min-h-12 rounded-2xl border border-line bg-paper px-3">
            <option value="">Keep</option>
            <option value="me">Assign to me</option>
            <option value="none">Unassigned</option>
          </select>
        </label>
        <button className="inline-flex min-h-12 items-center rounded-full bg-ink px-5 font-semibold text-white">Update</button>
      </form>
    </main>
  );
}
