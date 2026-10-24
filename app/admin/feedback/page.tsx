import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { LoadingMain } from "@/components/loading-main";
import { requireAdmin } from "@/lib/auth/session";
import {
  feedbackFilters,
  feedbackStatusLabel,
  feedbackStatuses,
  feedbackTypeLabel,
  feedbackTypes,
} from "@/lib/feedback";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Feedback" };

const pageSize = 20;

type FeedbackRow = {
  id: string;
  created_at: string;
  user_role: string;
  full_name: string | null;
  feedback_type: string;
  subject: string;
  status: string;
  total_count: number;
};

type FeedbackCounts = {
  total_count: number;
  new_count: number;
  under_review_count: number;
  planned_count: number;
  resolved_count: number;
};

export default function AdminFeedbackPage({ searchParams }: PageProps<"/admin/feedback">) {
  return (
    <Suspense fallback={<LoadingMain />}>
      <FeedbackList searchParams={searchParams} />
    </Suspense>
  );
}

async function FeedbackList({ searchParams }: { searchParams: PageProps<"/admin/feedback">["searchParams"] }) {
  await requireAdmin("/admin/feedback");
  const filters = feedbackFilters(await searchParams);
  const supabase = await createClient();
  const [{ data: counts }, { data, error }] = await Promise.all([
    supabase.rpc("beta_feedback_counts").maybeSingle<FeedbackCounts>(),
    supabase.rpc("list_beta_feedback", {
      status_filter: filters.status,
      type_filter: filters.type,
      role_filter: filters.role,
      from_date: filters.from || null,
      to_date: filters.to || null,
      search: filters.q,
      page_size: pageSize,
      page_offset: (filters.page - 1) * pageSize,
    }),
  ]);
  const rows = (data ?? []) as FeedbackRow[];
  const total = Number(rows[0]?.total_count ?? 0);
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const summary = counts ?? {
    total_count: 0,
    new_count: 0,
    under_review_count: 0,
    planned_count: 0,
    resolved_count: 0,
  };

  return (
    <main className="px-4 py-8">
      <h1 className="font-display text-4xl font-semibold tracking-tight text-ink">Feedback</h1>
      <p className="mt-3 max-w-2xl text-base leading-relaxed text-muted">
        Notes here stay inside admin. Sending feedback does not text or email anyone.
      </p>
      <ul className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Count label="Total Feedback" value={summary.total_count} />
        <Count label="New" value={summary.new_count} />
        <Count label="Under Review" value={summary.under_review_count} />
        <Count label="Planned" value={summary.planned_count} />
        <Count label="Resolved" value={summary.resolved_count} />
      </ul>
      <form method="get" className="mt-6 grid gap-3 sm:grid-cols-3">
        <Filter name="status" label="Status" value={filters.status} options={feedbackStatuses} />
        <Filter name="type" label="Category" value={filters.type} options={feedbackTypes} />
        <label className="grid gap-1 text-sm font-semibold text-ink">
          Role
          <select name="role" defaultValue={filters.role} className="min-h-12 rounded-2xl bg-paper-raised px-3 text-base font-normal ring-1 ring-line">
            <option value="">Any role</option>
            <option value="customer">Customer</option>
            <option value="driver">Driver</option>
            <option value="admin">Admin</option>
          </select>
        </label>
        <label className="grid gap-1 text-sm font-semibold text-ink">
          From
          <input type="date" name="from" defaultValue={filters.from} className="min-h-12 rounded-2xl bg-paper-raised px-3 text-base font-normal ring-1 ring-line" />
        </label>
        <label className="grid gap-1 text-sm font-semibold text-ink">
          To
          <input type="date" name="to" defaultValue={filters.to} className="min-h-12 rounded-2xl bg-paper-raised px-3 text-base font-normal ring-1 ring-line" />
        </label>
        <label className="grid gap-1 text-sm font-semibold text-ink">
          Search
          <input name="q" defaultValue={filters.q} maxLength={80} className="min-h-12 rounded-2xl bg-paper-raised px-3 text-base font-normal ring-1 ring-line" />
        </label>
        <button type="submit" className="inline-flex min-h-12 items-center justify-center rounded-full bg-brand px-5 text-base font-semibold text-white sm:col-span-3 sm:w-fit">
          Apply filters
        </button>
      </form>
      {error ? <p className="mt-4 text-base text-danger">Feedback could not be loaded.</p> : null}
      {rows.length === 0 && !error ? <p className="mt-6 text-base text-muted">No feedback matches these filters.</p> : null}
      <ul className="mt-4 space-y-3">
        {rows.map((row) => (
          <li key={row.id}>
            <Link href={`/admin/feedback/${row.id}`} className="block rounded-3xl bg-paper-raised p-4 ring-1 ring-line">
              <span className="font-semibold text-ink">{row.subject}</span>
              <span className="mt-1 block text-base text-muted">
                {stamp(row.created_at)} · {row.user_role} · {row.full_name?.trim() || "No name on file"} · {feedbackTypeLabel(row.feedback_type)} · {feedbackStatusLabel(row.status)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {pages > 1 ? (
        <p className="mt-4 flex gap-3">
          {filters.page > 1 ? <Link className="inline-flex min-h-12 items-center font-semibold text-brand" href={pageHref(filters, filters.page - 1)}>Previous</Link> : null}
          {filters.page < pages ? <Link className="inline-flex min-h-12 items-center font-semibold text-brand" href={pageHref(filters, filters.page + 1)}>Next</Link> : null}
        </p>
      ) : null}
    </main>
  );
}

function Count({ label, value }: { label: string; value: number }) {
  return (
    <li className="rounded-3xl bg-paper-raised p-4 ring-1 ring-line">
      <span className="block text-sm font-semibold text-muted">{label}</span>
      <span className="mt-1 block font-display text-3xl font-semibold text-ink">{value}</span>
    </li>
  );
}

function Filter({
  name,
  label,
  value,
  options,
}: {
  name: string;
  label: string;
  value: string;
  options: readonly { id: string; label: string }[];
}) {
  return (
    <label className="grid gap-1 text-sm font-semibold text-ink">
      {label}
      <select name={name} defaultValue={value} className="min-h-12 rounded-2xl bg-paper-raised px-3 text-base font-normal ring-1 ring-line">
        <option value="">Any</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function stamp(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "America/New_York",
  }).format(new Date(value));
}

function pageHref(filters: ReturnType<typeof feedbackFilters>, page: number): string {
  const params = new URLSearchParams();
  if (filters.status) params.set("status", filters.status);
  if (filters.type) params.set("type", filters.type);
  if (filters.role) params.set("role", filters.role);
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  if (filters.q) params.set("q", filters.q);
  params.set("page", String(page));
  return `/admin/feedback?${params.toString()}`;
}
