import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { replyHelpRequest } from "@/app/help/actions";
import { LoadingMain } from "@/components/loading-main";
import { requireSignedIn } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Help request" };

const labels: Record<string, string> = { open: "Open", waiting: "Waiting on you", resolved: "Resolved" };

export default function HelpRequestPage({ params, searchParams }: PageProps<"/help/requests/[id]">) {
  return (
    <Suspense fallback={<LoadingMain />}>
      <Request params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Request({
  params,
  searchParams,
}: {
  params: PageProps<"/help/requests/[id]">["params"];
  searchParams: PageProps<"/help/requests/[id]">["searchParams"];
}) {
  await requireSignedIn("/help/requests");
  const { id } = await params;
  const query = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createClient();
  const { data: request } = await supabase.from("help_requests").select("id, case_number, topic, body, status, job_id").eq("id", id).maybeSingle();
  if (!request) notFound();
  const { data: messages } = await supabase.from("help_messages").select("id, body, created_at, sender_id").eq("request_id", id).order("created_at");
  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-4 py-8">
      <Link href="/help/requests" className="inline-flex min-h-12 items-center font-semibold text-brand">
        ← My requests
      </Link>
      <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight text-ink">{request.case_number}</h1>
      <p className="mt-2 text-base text-ink">{labels[request.status] ?? request.status}</p>
      {query.sent === "1" ? <p className="mt-3 text-base text-ink">We got your request ({request.case_number}). We&apos;ll reply here.</p> : null}
      <p className="mt-4 text-base text-ink">{request.body}</p>
      <ul className="mt-4 space-y-3">
        {(messages ?? []).map((message) => (
          <li key={message.id} className="rounded-3xl bg-paper-raised p-4 ring-1 ring-line">
            <p className="text-base text-ink">{message.body}</p>
          </li>
        ))}
      </ul>
      {request.status !== "resolved" ? (
        <form action={replyHelpRequest} className="mt-6 space-y-3">
          <input type="hidden" name="requestId" value={request.id} />
          <label className="block font-semibold" htmlFor="reply">
            Reply
            <textarea id="reply" name="body" required className="mt-2 min-h-24 w-full rounded-2xl border border-line px-4 py-3" />
          </label>
          <button type="submit" className="inline-flex min-h-12 items-center rounded-full bg-brand px-6 font-semibold text-white">
            Send reply
          </button>
        </form>
      ) : null}
    </main>
  );
}
