import { reinstateAccount, suspendAccount } from "@/app/admin/accounts/actions";
import { formatInNewYork } from "@/lib/account/restriction";
import { createClient } from "@/lib/supabase/server";

const activeStatuses = ["assigned", "en_route", "arrived", "item_check", "in_transit", "delivered"];

export async function AccountControls({
  profileId,
  returnTo,
  label,
}: {
  profileId: string;
  returnTo: string;
  label: string;
}) {
  const supabase = await createClient();
  const [{ data: rows }, { data: jobs }] = await Promise.all([
    supabase
      .from("account_suspensions")
      .select("id, status, kind, reason, note, expires_at, created_at, ended_at")
      .eq("profile_id", profileId)
      .order("created_at", { ascending: false }),
    supabase
      .from("jobs")
      .select("id, status, service")
      .or(`customer_id.eq.${profileId},assigned_driver_id.eq.${profileId}`)
      .in("status", activeStatuses),
  ]);
  const history = rows ?? [];
  const current = history.find((row) => row.status === "active");

  return (
    <section className="mt-8 rounded-3xl bg-paper-raised p-4 ring-1 ring-line">
      <h2 className="font-display text-2xl font-semibold text-ink">{label}</h2>
      <p className="mt-2 text-base text-ink">
        {current
          ? current.kind === "temporary" && current.expires_at
            ? `Restricted until ${formatInNewYork(current.expires_at)}.`
            : "Restricted with no end date."
          : "Not restricted."}
      </p>
      <h3 className="mt-4 text-base font-semibold text-ink">Active jobs</h3>
      {(jobs ?? []).length === 0 ? <p className="mt-1 text-base text-muted">No active jobs.</p> : null}
      <ul className="mt-2 space-y-2">
        {(jobs ?? []).map((job) => (
          <li key={job.id}>
            <a href={`/admin/requests/${job.id}`} className="font-semibold text-brand">
              {job.service} · {job.status}
            </a>
          </li>
        ))}
      </ul>
      <h3 className="mt-4 text-base font-semibold text-ink">History</h3>
      {history.length === 0 ? <p className="mt-1 text-base text-muted">No restrictions yet.</p> : null}
      <ul className="mt-2 space-y-3">
        {history.map((row) => (
          <li key={row.id} className="text-base text-ink">
            <p>
              {row.status} · {row.kind} · {formatInNewYork(row.created_at)}
            </p>
            <p>{row.reason}</p>
            {row.note ? <p className="text-muted">Internal note: {row.note}</p> : null}
            {row.ended_at ? <p className="text-muted">Ended {formatInNewYork(row.ended_at)}</p> : null}
          </li>
        ))}
      </ul>
      {current ? (
        <form action={reinstateAccount} className="mt-4">
          <input type="hidden" name="profileId" value={profileId} />
          <input type="hidden" name="returnTo" value={returnTo} />
          <button type="submit" className="inline-flex min-h-12 items-center justify-center rounded-full bg-ink px-6 font-semibold text-white">
            Reinstate Account
          </button>
        </form>
      ) : null}
      <form action={suspendAccount} className="mt-4 space-y-3">
          <input type="hidden" name="profileId" value={profileId} />
          <input type="hidden" name="returnTo" value={returnTo} />
          <label className="block text-base font-semibold text-ink" htmlFor={`kind-${profileId}`}>
            Restriction
            <select id={`kind-${profileId}`} name="kind" className="mt-2 min-h-12 w-full rounded-2xl border border-line bg-paper px-4">
              <option value="temporary">Temporary</option>
              <option value="indefinite">Indefinite</option>
            </select>
          </label>
          <label className="block text-base font-semibold text-ink" htmlFor={`until-${profileId}`}>
            Ends (Eastern time, temporary only)
            <input id={`until-${profileId}`} name="expiresAt" type="datetime-local" className="mt-2 min-h-12 w-full rounded-2xl border border-line bg-paper px-4" />
          </label>
          <label className="block text-base font-semibold text-ink" htmlFor={`reason-${profileId}`}>
            Reason
            <textarea id={`reason-${profileId}`} name="reason" required className="mt-2 min-h-24 w-full rounded-2xl border border-line bg-paper px-4 py-3" />
          </label>
          <label className="block text-base font-semibold text-ink" htmlFor={`note-${profileId}`}>
            Internal note
            <textarea id={`note-${profileId}`} name="note" className="mt-2 min-h-20 w-full rounded-2xl border border-line bg-paper px-4 py-3" />
          </label>
          <button type="submit" className="inline-flex min-h-12 items-center justify-center rounded-full bg-ink px-6 font-semibold text-white">
            {current ? "Update restriction" : "Suspend Account"}
          </button>
        </form>
    </section>
  );
}
