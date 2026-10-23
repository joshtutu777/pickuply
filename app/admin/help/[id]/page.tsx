import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { replyHelpRequest, setHelpStatus } from "@/app/help/actions";
import { LoadingMain } from "@/components/loading-main";
import { requireAdmin } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Help request" };

export default function AdminHelpRequestPage({ params, searchParams }: PageProps<"/admin/help/[id]">) {
  return (
    <Suspense fallback={<LoadingMain />}>
      <Detail params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Detail({
  params,
  searchParams,
}: {
  params: PageProps<"/admin/help/[id]">["params"];
  searchParams: PageProps<"/admin/help/[id]">["searchParams"];
}) {
  await requireAdmin("/admin/help");
  const { id } = await params;
  const query = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createClient();
  const { data: request } = await supabase.from("help_request_list").select("*").eq("id", id).maybeSingle();
  if (!request) notFound();
  const { data: messages } = await supabase.from("help_messages").select("id, body, created_at").eq("request_id", id).order("created_at");
  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-4 py-8">
      <Link href="/admin/help" className="inline-flex min-h-12 items-center font-semibold text-brand">
        ← Help queue
      </Link>
      <h1 className="mt-3 font-display text-4xl font-semibold text-ink">{request.case_number}</h1>
      <p className="mt-2 text-base text-muted">
        Waiting {request.waited_minutes} min · {request.status}
      </p>
      {typeof query.error === "string" ? <p className="mt-3 text-danger">{query.error}</p> : null}
      <p className="mt-4 text-base text-ink">{request.body}</p>
      {request.job_id ? (
        <p className="mt-3">
          <Link href={`/admin/requests/${request.job_id}`} className="font-semibold text-brand">
            Open the job
          </Link>
        </p>
      ) : null}
      <ul className="mt-4 space-y-3">
        {(messages ?? []).map((message) => (
          <li key={message.id} className="rounded-3xl bg-paper-raised p-4">{message.body}</li>
        ))}
      </ul>
      <form action={replyHelpRequest} className="mt-6 space-y-3">
        <input type="hidden" name="requestId" value={id} />
        <input type="hidden" name="back" value={`/admin/help/${id}`} />
        <label className="block font-semibold" htmlFor="reply">
          Reply
          <textarea id="reply" name="body" required className="mt-2 min-h-24 w-full rounded-2xl border border-line px-4 py-3" />
        </label>
        <button type="submit" className="inline-flex min-h-12 items-center rounded-full bg-brand px-6 font-semibold text-white">
          Send reply
        </button>
      </form>
      <form action={setHelpStatus} className="mt-4 flex flex-wrap gap-2">
        <input type="hidden" name="requestId" value={id} />
        {["open", "waiting", "resolved"].map((status) => (
          <button key={status} type="submit" name="status" value={status} className="inline-flex min-h-12 items-center rounded-full bg-paper-raised px-4 font-semibold ring-1 ring-line">
            {status}
          </button>
        ))}
      </form>
    </main>
  );
}
