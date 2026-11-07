import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { LoadingMain } from "@/components/loading-main";
import { IncludeTestData } from "@/components/admin/include-test-data";
import { includeTestParam } from "@/lib/admin/test-lane";
import { resolveTestLane } from "@/lib/admin/test-lane-server";
import { requireAdmin } from "@/lib/auth/session";
import { formatUsPhone } from "@/lib/phone";
import { displayFullName } from "@/lib/auth/name";
import { registrationFilter, registrationLabel } from "@/lib/auth/registration";
import { formatSignupDate } from "@/lib/time/when";
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
  const registration = registrationFilter(typeof params.registration === "string" ? params.registration : undefined);
  const lane = await resolveTestLane(includeTestParam(params.includeTest));
  const supabase = await createClient();
  const counted = () => {
    let countRequest = supabase.from("profiles").select("id", { count: "exact", head: true }).eq("role", "customer").is("deleted_at", null);
    if (lane !== "all") countRequest = countRequest.eq("is_test", lane === "test");
    return countRequest;
  };
  const [{ count: registeredCount }, { count: unfinishedCount }] = await Promise.all([
    counted().not("registration_completed_at", "is", null),
    counted().is("registration_completed_at", null),
  ]);
  let request = supabase
    .from("profiles")
    .select("id, full_name, first_name, last_name, phone, role, deleted_at, reclaim_hold_at, is_test, created_at, registration_completed_at", { count: "exact" })
    .eq("role", "customer")
    .limit(200);
  if (registration === "complete") {
    request = request.not("registration_completed_at", "is", null).order("registration_completed_at", { ascending: false });
  } else if (registration === "incomplete") {
    request = request.is("registration_completed_at", null).order("created_at", { ascending: false });
  } else {
    request = request.order("created_at", { ascending: false });
  }
  if (lane !== "all") request = request.eq("is_test", lane === "test");
  if (q) request = request.or(`full_name.ilike.%${q}%,first_name.ilike.%${q}%,last_name.ilike.%${q}%,phone.ilike.%${q}%`);
  if (filter === "review") request = request.not("reclaim_hold_at", "is", null);
  if (filter === "deleted") request = request.not("deleted_at", "is", null);
  else request = request.is("deleted_at", null);
  const kept = new URLSearchParams();
  if (q) kept.set("q", q);
  if (filter !== "all") kept.set("status", filter);
  if (registration !== "complete") kept.set("registration", registration);
  if (lane === "all") kept.set("includeTest", "1");
  const { data, error, count } = await request;
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
      <p className="mt-3 text-base text-muted">
        {registration === "incomplete"
          ? "Customers who verified a phone and have not finished their name."
          : registration === "all"
            ? "Every customer account. Phone verification alone is not a finished registration."
            : "Finished registrations. A customer is listed here after a first and last name are saved."}
      </p>
      <p className="mt-2 text-base text-ink">
        {registeredCount ?? 0} registered. {unfinishedCount ?? 0} verified a phone and have not finished their name.
      </p>
      {lane === "test" ? null : (
        <IncludeTestData include={lane === "all"} path="/admin/customers" search={kept.toString()} />
      )}
      <form className="mt-6 grid gap-3 sm:grid-cols-2" action="/admin/customers">
        {lane === "all" ? <input type="hidden" name="includeTest" value="1" /> : null}
        <label className="font-semibold text-ink">
          Search
          <input name="q" defaultValue={q} className="mt-2 min-h-12 w-full rounded-2xl border border-line bg-paper px-4" />
        </label>
        <label className="font-semibold text-ink">
          Registration
          <select name="registration" defaultValue={registration} className="mt-2 min-h-12 w-full rounded-2xl border border-line bg-paper px-4">
            <option value="complete">Completed registrations</option>
            <option value="incomplete">Registration not finished</option>
            <option value="all">All customers</option>
          </select>
        </label>
        <label className="font-semibold text-ink sm:col-span-2">
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
      {count != null && count > rows.length ? (
        <p className="mt-4 text-base text-muted">Showing the newest {rows.length} of {count} customer accounts.</p>
      ) : null}
      <ul className="mt-4 grid gap-2">
        {shown.map((row) => (
          <li key={row.id}>
            <Link href={`/admin/customers/${row.id}`} className="flex min-h-12 items-center justify-between gap-3 rounded-2xl bg-paper-raised px-4 ring-1 ring-line">
              <span>
                <span className="block font-semibold text-ink">
                  {displayFullName({ firstName: row.first_name, lastName: row.last_name, fullName: row.full_name }) ?? "Unnamed"}
                </span>
                <span className="block text-sm text-muted">{row.phone ? formatUsPhone(row.phone) ?? row.phone : "No phone"}</span>
                <span className="block text-sm text-muted">Phone verified {formatSignupDate(row.created_at)}</span>
                <span className="block text-sm text-muted">
                  {row.registration_completed_at ? `Registered ${formatSignupDate(row.registration_completed_at)}` : "Registration not finished"}
                </span>
              </span>
              <span className="text-sm text-muted">
                {row.deleted_at
                  ? "Deleted"
                  : row.reclaim_hold_at
                    ? "Phone review"
                    : suspended.has(row.id)
                      ? "Suspended"
                      : pending.has(row.id)
                        ? "Deletion pending"
                        : registrationLabel({
                            completedAt: row.registration_completed_at,
                            firstName: row.first_name,
                            lastName: row.last_name,
                            fullName: row.full_name,
                          })}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
