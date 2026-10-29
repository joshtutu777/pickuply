import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { LoadingMain } from "@/components/loading-main";
import { requireAdmin } from "@/lib/auth/session";
import { supportStatusLabel, supportTopicLabel } from "@/lib/support/ticket";
import { createClient } from "@/lib/supabase/server";
import { IncludeTestData } from "@/components/admin/include-test-data";
import { includeTestParam } from "@/lib/admin/test-lane";
import { resolveTestLane } from "@/lib/admin/test-lane-server";

export const metadata: Metadata = { title: "Support" };

const statuses = ["", "open", "awaiting_customer", "resolved", "closed"] as const;

export default function AdminSupportPage({ searchParams }: PageProps<"/admin/support">) {
  return (
    <Suspense fallback={<LoadingMain />}>
      <SupportInbox searchParams={searchParams} />
    </Suspense>
  );
}

async function SupportInbox({ searchParams }: { searchParams: PageProps<"/admin/support">["searchParams"] }) {
  await requireAdmin("/admin/support");
  const query = await searchParams;
  const lane = await resolveTestLane(includeTestParam(query.includeTest));
  const status = statuses.includes(query.status as (typeof statuses)[number]) ? String(query.status ?? "") : "";
  const q = typeof query.q === "string" ? query.q.replace(/[^a-zA-Z0-9 @.-]/g, "").trim().slice(0, 80) : "";
  const supabase = await createClient();
  const counts = await Promise.all(
    (["open", "awaiting_customer", "resolved", "closed"] as const).map(async (item) => {
      let countRequest = supabase.from("support_tickets").select("id", { count: "exact", head: true }).eq("status", item);
      if (lane !== "all") countRequest = countRequest.eq("is_test", lane === "test");
      const result = await countRequest;
      return [item, result.count ?? 0] as const;
    }),
  );
  const countOf = Object.fromEntries(counts);
  let request = supabase
    .from("support_tickets")
    .select("id, reference, first_name, last_name, email, topic, status, is_test, created_at, updated_at")
    .order("created_at", { ascending: false })
    .limit(50);
  if (lane !== "all") request = request.eq("is_test", lane === "test");
  if (status) request = request.eq("status", status);
  if (q) request = request.or(`reference.ilike.%${q}%,email.ilike.%${q}%,first_name.ilike.%${q}%`);
  const { data, error } = await request;
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">
      <h1 className="font-display text-4xl font-semibold tracking-tight">Support</h1>
      {lane === "test" ? null : (
        <IncludeTestData include={lane === "all"} path="/admin/support" search={lane === "all" ? "includeTest=1" : ""} />
      )}
      <ul className="mt-4 flex flex-wrap gap-2">
        <li><Link href="/admin/support" className="inline-flex min-h-12 items-center rounded-full bg-paper-raised px-4 font-semibold ring-1 ring-line">All {(countOf.open ?? 0) + (countOf.awaiting_customer ?? 0) + (countOf.resolved ?? 0) + (countOf.closed ?? 0)}</Link></li>
        <li><Link href="/admin/support?status=open" className="inline-flex min-h-12 items-center rounded-full bg-paper-raised px-4 font-semibold ring-1 ring-line">Open {countOf.open}</Link></li>
        <li><Link href="/admin/support?status=awaiting_customer" className="inline-flex min-h-12 items-center rounded-full bg-paper-raised px-4 font-semibold ring-1 ring-line">Awaiting customer {countOf.awaiting_customer}</Link></li>
        <li><Link href="/admin/support?status=resolved" className="inline-flex min-h-12 items-center rounded-full bg-paper-raised px-4 font-semibold ring-1 ring-line">Resolved {countOf.resolved}</Link></li>
        <li><Link href="/admin/support?status=closed" className="inline-flex min-h-12 items-center rounded-full bg-paper-raised px-4 font-semibold ring-1 ring-line">Closed {countOf.closed}</Link></li>
      </ul>
      <form method="get" className="mt-4 flex flex-wrap gap-2" role="search">
        <label className="sr-only" htmlFor="support-search">Search requests</label>
        <input id="support-search" name="q" defaultValue={q} placeholder="Search name, email, or reference" className="min-h-12 flex-1 rounded-2xl border border-line bg-paper px-4" />
        {status ? <input type="hidden" name="status" value={status} /> : null}
        <button className="inline-flex min-h-12 items-center rounded-full bg-ink px-4 font-semibold text-white">Search</button>
      </form>
      {error ? <p role="alert" className="mt-4 text-danger">Requests could not be loaded.</p> : null}
      {(data ?? []).length === 0 ? <p className="mt-6 text-base text-muted">No requests match.</p> : null}
      <ul className="mt-4 grid gap-2">
        {(data ?? []).map((ticket) => (
          <li key={ticket.id}>
            <Link href={`/admin/support/${ticket.id}`} className="grid gap-1 rounded-3xl bg-paper-raised p-4 ring-1 ring-line sm:grid-cols-[1fr_auto]">
              <span className="font-semibold">{ticket.reference} · {ticket.first_name} {ticket.last_name}</span>
              <span>{supportStatusLabel(ticket.status)}</span>
              <span className="text-muted">{supportTopicLabel(ticket.topic)} · {ticket.email}{ticket.is_test ? " · Test" : ""}</span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
