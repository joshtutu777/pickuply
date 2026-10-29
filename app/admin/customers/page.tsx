import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { LoadingMain } from "@/components/loading-main";
import { IncludeTestData } from "@/components/admin/include-test-data";
import { includeTestParam } from "@/lib/admin/test-lane";
import { resolveTestLane } from "@/lib/admin/test-lane-server";
import { requireAdmin } from "@/lib/auth/session";
import { formatUsPhone } from "@/lib/phone";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: { absolute: "Customers · Pickuply Admin" } };

type CustomersPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default function CustomersPage({ searchParams }: CustomersPageProps) {
  return (
    <Suspense fallback={<LoadingMain />}>
      <Customers searchParams={searchParams} />
    </Suspense>
  );
}

async function Customers({ searchParams }: CustomersPageProps) {
  await requireAdmin("/admin/customers");
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q.replace(/[^a-zA-Z0-9 @.+-]/g, "").slice(0, 40) : "";
  const filter = typeof params.status === "string" ? params.status : "all";
  const lane = await resolveTestLane(includeTestParam(params.includeTest));
  const supabase = await createClient();
  let request = supabase
    .from("profiles")
    .select("id, full_name, phone, email, role, deleted_at, reclaim_hold_at, is_test")
    .order("full_name", { ascending: true })
    .limit(80);
  if (lane !== "all") request = request.eq("is_test", lane === "test");
  if (q) request = request.or(`full_name.ilike.%${q}%,phone.ilike.%${q}%,email.ilike.%${q}%`);
  if (filter === "review") request = request.not("reclaim_hold_at", "is", null);
  if (filter === "deleted") request = request.not("deleted_at", "is", null);
  const { data, error } = await request;
  const rows = data ?? [];
  const ids = rows.map((row) => row.id);
  const { data: suspensions } = ids.length
    ? await supabase.from("account_suspensions").select("profile_id").eq("status", "active").in("profile_id", ids)
    : { data: [] };
  const { data: deletions } = ids.length
    ? await supabase.from("account_deletion_requests").select("profile_id").in("status", ["pending", "deferred"]).in("profile_id", ids)
    : { data: [] };
  const suspended = new Set((suspensions ?? []).map((row) => row.profile_id));
  const pending = new Set((deletions ?? []).map((row) => row.profile_id));
  const shown = filter === "suspended" ? rows.filter((row) => suspended.has(row.id)) : filter === "deletion" ? rows.filter((row) => pending.has(row.id)) : rows;

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
      <p className="text-sm font-semibold tracking-wide text-brand uppercase">Admin</p>
      <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight text-ink">Customers</h1>
      {lane === "test" ? null : (
        <IncludeTestData include={lane === "all"} path="/admin/customers" search={lane === "all" ? "includeTest=1" : ""} />
      )}
      <form className="mt-6 grid gap-3 sm:grid-cols-[1fr_auto]" action="/admin/customers">
        <label className="font-semibold text-ink">
          Search
          <input name="q" defaultValue={q} className="mt-2 min-h-12 w-full rounded-2xl border border-line bg-paper px-4" />
        </label>
        <label className="font-semibold text-ink">
          Status
          <select name="status" defaultValue={filter} className="mt-2 min-h-12 w-full rounded-2xl border border-line bg-paper px-4">
            <option value="all">All</option>
            <option value="suspended">Suspended</option>
            <option value="deletion">Deletion pending</option>
            <option value="review">Phone review</option>
            <option value="deleted">Deleted</option>
          </select>
        </label>
        <button type="submit" className="inline-flex min-h-12 items-center justify-center rounded-full bg-brand px-6 font-semibold text-white sm:col-span-2">
          Apply
        </button>
      </form>
      {error ? <p role="alert" className="mt-4 text-base text-danger">The customer list could not be loaded.</p> : null}
      {shown.length === 0 ? <p className="mt-6 text-base text-muted">No matching customers.</p> : null}
      <ul className="mt-4 grid gap-2">
        {shown.map((row) => (
          <li key={row.id}>
            <Link href={`/admin/customers/${row.id}`} className="flex min-h-12 items-center justify-between gap-3 rounded-2xl bg-paper-raised px-4 ring-1 ring-line">
              <span>
                <span className="block font-semibold text-ink">{row.full_name ?? "Unnamed"}</span>
                <span className="block text-sm text-muted">{row.phone ? formatUsPhone(row.phone) ?? row.phone : "No phone"}</span>
                <span className="block text-sm text-muted">{row.email?.trim() || "No email"}</span>
              </span>
              <span className="text-sm text-muted">
                {row.deleted_at ? "Deleted" : row.reclaim_hold_at ? "Phone review" : suspended.has(row.id) ? "Suspended" : pending.has(row.id) ? "Deletion pending" : row.role}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
