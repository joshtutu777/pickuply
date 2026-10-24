import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { reviewFeedback } from "@/app/admin/feedback/actions";
import { LoadingMain } from "@/components/loading-main";
import { requireAdmin } from "@/lib/auth/session";
import { feedbackStatusLabel, feedbackStatuses, feedbackTypeLabel } from "@/lib/feedback";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Feedback" };

type FeedbackDetail = {
  id: string;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  user_role: string;
  full_name: string | null;
  feedback_type: string;
  subject: string;
  description: string;
  page_path: string;
  app_version: string | null;
  device_info: string | null;
  status: string;
  admin_notes: string | null;
};

export default function AdminFeedbackDetailPage({ params, searchParams }: PageProps<"/admin/feedback/[id]">) {
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
  params: PageProps<"/admin/feedback/[id]">["params"];
  searchParams: PageProps<"/admin/feedback/[id]">["searchParams"];
}) {
  await requireAdmin("/admin/feedback");
  const { id } = await params;
  const query = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createClient();
  const { data } = await supabase.rpc("read_beta_feedback", { target_id: id }).maybeSingle<FeedbackDetail>();
  if (!data) notFound();

  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-4 py-8">
      <Link href="/admin/feedback" className="inline-flex min-h-12 items-center font-semibold text-brand">
        ← Feedback
      </Link>
      <h1 className="mt-3 font-display text-4xl font-semibold text-ink">{data.subject}</h1>
      <p className="mt-2 text-base text-muted">
        {feedbackTypeLabel(data.feedback_type)} · {feedbackStatusLabel(data.status)} · {data.user_role} · {data.full_name?.trim() || "No name on file"}
      </p>
      {query.saved === "1" ? <p className="mt-3 text-base font-semibold text-ink">Saved</p> : null}
      {query.error === "save" ? <p className="mt-3 text-base text-danger">That update did not save.</p> : null}
      <p className="mt-4 whitespace-pre-wrap text-base leading-relaxed text-ink">{data.description}</p>
      <dl className="mt-6 grid gap-2 text-base text-ink">
        <div>
          <dt className="font-semibold">Page</dt>
          <dd>{data.page_path}</dd>
        </div>
        <div>
          <dt className="font-semibold">Version</dt>
          <dd>{data.app_version || "—"}</dd>
        </div>
        <div>
          <dt className="font-semibold">Device</dt>
          <dd>{data.device_info || "—"}</dd>
        </div>
        <div>
          <dt className="font-semibold">Submitted</dt>
          <dd>{stamp(data.created_at)}</dd>
        </div>
        <div>
          <dt className="font-semibold">Updated</dt>
          <dd>{stamp(data.updated_at)}</dd>
        </div>
        <div>
          <dt className="font-semibold">Resolved</dt>
          <dd>{data.resolved_at ? stamp(data.resolved_at) : "—"}</dd>
        </div>
      </dl>
      <form action={reviewFeedback} className="mt-6 grid gap-3">
        <input type="hidden" name="id" value={data.id} />
        <label className="grid gap-2 text-base font-semibold text-ink">
          Status
          <select name="status" defaultValue={data.status} className="min-h-12 rounded-2xl bg-paper-raised px-3 font-normal ring-1 ring-line">
            {feedbackStatuses.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-2 text-base font-semibold text-ink">
          Internal notes
          <textarea
            name="notes"
            defaultValue={data.admin_notes ?? ""}
            maxLength={4000}
            rows={5}
            className="rounded-2xl bg-paper-raised px-3 py-3 font-normal ring-1 ring-line"
          />
        </label>
        <p className="text-sm text-muted">Customers and drivers cannot see these notes.</p>
        <div className="flex flex-col gap-3 sm:flex-row">
          <button type="submit" className="inline-flex min-h-12 items-center justify-center rounded-full bg-brand px-5 text-base font-semibold text-white">
            Save
          </button>
          <button
            type="submit"
            name="intent"
            value="resolve"
            className="inline-flex min-h-12 items-center justify-center rounded-full bg-paper-raised px-5 text-base font-semibold text-ink ring-1 ring-line"
          >
            Mark resolved
          </button>
        </div>
      </form>
    </main>
  );
}

function stamp(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  }).format(new Date(value));
}
