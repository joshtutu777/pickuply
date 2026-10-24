import { Suspense } from "react";
import { completeDeletion, deferDeletion } from "@/app/admin/accounts/actions";
import { LoadingMain } from "@/components/loading-main";
import { blockerLabel, formatInNewYork } from "@/lib/account/restriction";
import { singleQuery } from "@/lib/auth/query";
import { requireAdmin } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

type Search = Promise<Record<string, string | string[] | undefined>>;

export default function AdminAccountsPage({ searchParams }: { searchParams: Search }) {
  return (
    <Suspense fallback={<LoadingMain />}>
      <Accounts searchParams={searchParams} />
    </Suspense>
  );
}

async function Accounts({ searchParams }: { searchParams: Search }) {
  await requireAdmin("/admin/accounts");
  const params = await searchParams;
  const supabase = await createClient();
  const { data: requests } = await supabase
    .from("account_deletion_requests")
    .select("id, profile_id, status, blockers, requested_at, completed_at")
    .order("requested_at", { ascending: false })
    .limit(50);
  const ids = [...new Set((requests ?? []).map((row) => row.profile_id))];
  const { data: names } =
    ids.length > 0
      ? await supabase.from("profiles").select("id, full_name, role").in("id", ids)
      : { data: [] as { id: string; full_name: string | null; role: string }[] };
  const nameById = new Map((names ?? []).map((row) => [row.id, row]));
  const saved = singleQuery(params.saved);
  const error = singleQuery(params.error);

  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-4 py-8">
      <p className="text-sm font-semibold tracking-wide text-brand uppercase">Admin</p>
      <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight text-ink">Accounts</h1>
      <p className="mt-2 text-base text-muted">Deletion requests. Open a driver or request to suspend an account.</p>
      {saved ? <p className="mt-4 text-base text-ink">Saved.</p> : null}
      {error ? (
        <p role="alert" className="mt-4 text-base text-danger">
          {error}
        </p>
      ) : null}
      {(requests ?? []).length === 0 ? <p className="mt-6 text-base text-muted">No deletion requests.</p> : null}
      <ul className="mt-6 space-y-4">
        {(requests ?? []).map((row) => {
          const person = nameById.get(row.profile_id);
          const blockers = Array.isArray(row.blockers) ? row.blockers : [];
          return (
            <li key={row.id} className="rounded-3xl bg-paper-raised p-4 ring-1 ring-line">
              <p className="text-base font-semibold text-ink">{person?.full_name ?? "Account"}</p>
              <p className="text-base text-muted">
                {person?.role ?? "account"} · {row.status} · {formatInNewYork(row.requested_at)}
              </p>
              {row.completed_at ? <p className="text-base text-muted">Completed {formatInNewYork(row.completed_at)}</p> : null}
              {blockers.length > 0 ? (
                <ul className="mt-2 list-disc pl-5 text-base text-ink">
                  {blockers.map((code: string) => (
                    <li key={code}>{blockerLabel(code)}</li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-base text-muted">No listed blockers.</p>
              )}
              {row.status === "pending" ? (
                <div className="mt-3 flex flex-wrap gap-3">
                  <form action={completeDeletion}>
                    <input type="hidden" name="profileId" value={row.profile_id} />
                    <button type="submit" className="inline-flex min-h-12 items-center rounded-full bg-ink px-5 font-semibold text-white">
                      Complete deletion
                    </button>
                  </form>
                  <form action={deferDeletion} className="flex flex-wrap items-end gap-2">
                    <input type="hidden" name="profileId" value={row.profile_id} />
                    <label className="text-sm font-semibold text-ink" htmlFor={`defer-${row.id}`}>
                      Defer reason
                      <input id={`defer-${row.id}`} name="reason" required className="mt-1 block min-h-12 rounded-2xl border border-line bg-paper px-3" />
                    </label>
                    <button type="submit" className="inline-flex min-h-12 items-center rounded-full bg-paper px-5 font-semibold text-ink ring-1 ring-line">
                      Defer
                    </button>
                  </form>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </main>
  );
}
