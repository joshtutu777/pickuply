import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { replyToSupportTicket } from "@/app/contact/actions";
import { LoadingMain } from "@/components/loading-main";
import { requireSignedIn } from "@/lib/auth/session";
import { supportStatusLabel, supportTopicLabel } from "@/lib/support/ticket";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Support request", robots: { index: false, follow: false } };

export default function TicketPage({ params, searchParams }: PageProps<"/contact/tickets/[id]">) {
  return (
    <Suspense fallback={<LoadingMain />}>
      <Ticket params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Ticket({
  params,
  searchParams,
}: {
  params: PageProps<"/contact/tickets/[id]">["params"];
  searchParams: PageProps<"/contact/tickets/[id]">["searchParams"];
}) {
  const session = await requireSignedIn("/contact");
  const { id } = await params;
  const query = await searchParams;
  const supabase = await createClient();
  const { data: ticket } = await supabase
    .from("support_tickets")
    .select("id, reference, topic, status, created_at, updated_at, profile_id")
    .eq("id", id)
    .maybeSingle();
  if (!ticket || ticket.profile_id !== session.userId) notFound();
  const { data: messages } = await supabase
    .from("support_ticket_messages")
    .select("id, kind, body, created_at")
    .eq("ticket_id", id)
    .order("created_at", { ascending: true });
  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-4 py-6">
      <Link href="/contact" className="inline-flex min-h-12 items-center font-semibold text-brand">Support</Link>
      <p className="mt-3 text-sm font-semibold tracking-wide text-brand uppercase">{ticket.reference}</p>
      <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight">{supportTopicLabel(ticket.topic)}</h1>
      <p className="mt-2 text-base text-muted">{supportStatusLabel(ticket.status)}</p>
      {query.sent === "1" ? <p className="mt-4 text-base">Reply sent.</p> : null}
      {query.error === "reply" ? <p role="alert" className="mt-4 text-base text-danger">The reply could not be sent.</p> : null}
      <ol className="mt-4 grid gap-3">
        {(messages ?? []).map((message) => (
          <li key={message.id} className="rounded-3xl bg-paper-raised p-4 ring-1 ring-line">
            <p className="text-sm font-semibold text-brand">{message.kind === "admin" ? "Pickuply" : "You"}</p>
            <p className="mt-2 whitespace-pre-wrap text-base">{message.body}</p>
          </li>
        ))}
      </ol>
      {ticket.status === "closed" ? null : (
        <form action={replyToSupportTicket} className="mt-4 grid gap-3">
          <input type="hidden" name="id" value={ticket.id} />
          <label className="grid gap-2 font-semibold">
            Reply
            <textarea name="message" required rows={4} className="rounded-2xl border border-line bg-paper px-4 py-3 font-normal" />
          </label>
          <button className="inline-flex min-h-12 items-center justify-center rounded-full bg-brand px-5 font-semibold text-white">Send reply</button>
        </form>
      )}
    </main>
  );
}
