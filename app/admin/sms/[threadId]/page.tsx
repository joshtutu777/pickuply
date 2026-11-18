import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { replyToSms } from "@/app/admin/sms/actions";
import { SmsSectionNav, deliveryLabel } from "@/components/admin/sms-section";
import { LoadingMain } from "@/components/loading-main";
import { requireAdmin } from "@/lib/auth/session";
import { formatUsPhone } from "@/lib/phone";
import { createClient } from "@/lib/supabase/server";
import { formatUsWhen } from "@/lib/time/when";

export const metadata: Metadata = { title: { absolute: "Text conversation · Pickuply Admin" } };
const field = "mt-2 min-h-12 w-full rounded-2xl border border-line bg-paper px-4";
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default function ThreadPage({
  params,
  searchParams,
}: {
  params: Promise<{ threadId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <Suspense fallback={<LoadingMain />}>
      <Thread params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Thread({
  params,
  searchParams,
}: {
  params: Promise<{ threadId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { threadId } = await params;
  if (!uuidPattern.test(threadId)) notFound();
  await requireAdmin(`/admin/sms/${threadId}`);
  const query = await searchParams;
  const supabase = await createClient();
  await supabase.rpc("admin_mark_sms_read", { target: threadId });
  const thread = await supabase.from("sms_threads").select("id, phone, contact_name, contact_role, opted_out, profile_id").eq("id", threadId).maybeSingle();
  if (!thread.data) notFound();
  const messages = await supabase
    .from("sms_messages")
    .select("id, direction, body, status, failure_reason, created_at, sent_at, delivered_at")
    .eq("thread_id", threadId)
    .order("created_at", { ascending: true })
    .limit(100);
  const rows = messages.data ?? [];

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
      <p className="text-sm font-semibold tracking-wide text-brand uppercase">Admin</p>
      <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight text-ink">{thread.data.contact_name ?? "Unknown number"}</h1>
      <p className="mt-2 text-base text-muted">
        {formatUsPhone(thread.data.phone) ?? "Hidden number"} · {thread.data.profile_id ? thread.data.contact_role ?? "Account" : "No Pickuply account"}
        {thread.data.opted_out ? " · Opted out" : ""}
      </p>
      <SmsSectionNav current="inbox" />
      {typeof query.error === "string" ? <p role="alert" className="mt-4 text-base text-danger">{query.error}</p> : null}
      {query.saved ? <p className="mt-4 text-base font-semibold text-ink">Reply handed to the phone provider.</p> : null}
      {messages.error ? <p role="alert" className="mt-4 text-base text-danger">Messages could not be loaded.</p> : null}
      {!messages.error && rows.length === 0 ? <p className="mt-6 text-base text-muted">No messages in this conversation.</p> : null}
      <ol className="mt-4 grid gap-3">
        {rows.map((row) => (
          <li key={row.id} className={`rounded-3xl p-4 ring-1 ring-line ${row.direction === "out" ? "bg-paper" : "bg-paper-raised"}`}>
            <p className="text-sm font-semibold text-muted">{row.direction === "out" ? "Pickuply" : "Them"} · {deliveryLabel(row.status)} · {formatUsWhen(row.delivered_at ?? row.sent_at ?? row.created_at)}</p>
            <p className="mt-2 text-base text-ink">{row.body}</p>
            {row.failure_reason ? <p className="mt-2 text-sm text-danger">{row.failure_reason}</p> : null}
          </li>
        ))}
      </ol>
      {thread.data.opted_out ? (
        <p className="mt-6 text-base text-ink">This person opted out, so a reply cannot be sent.</p>
      ) : (
        <form action={replyToSms} className="mt-6 grid gap-3">
          <input type="hidden" name="thread" value={thread.data.id} />
          <label className="font-semibold text-ink">
            Reply
            <textarea name="body" required maxLength={500} className={`${field} min-h-28 py-3`} />
          </label>
          <button type="submit" className="inline-flex min-h-12 items-center justify-center rounded-full bg-brand px-6 font-semibold text-white">Send reply</button>
        </form>
      )}
    </main>
  );
}
