import Link from "next/link";
import { Suspense } from "react";
import { LoadingMain } from "@/components/loading-main";
import { requireAdmin } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

const order = [
  ["request_started", "1", "Request started"],
  ["request_screen", "2", "Request screen 2"],
  ["request_screen", "3", "Request screen 3"],
  ["request_screen", "4", "Request screen 4"],
  ["request_verified", "verified", "Phone verified"],
  ["request_submitted", "submitted", "Request submitted"],
  ["quote_sent", "sent", "Quote sent"],
  ["quote_viewed", "viewed", "Quote viewed"],
  ["quote_accepted", "accepted", "Quote accepted"],
  ["driver_apply_started", "apply", "Driver apply started"],
  ["driver_submitted", "submitted", "Driver application submitted"],
  ["driver_checklist", "insurance", "Insurance saved"],
  ["driver_checklist", "vehicle", "Vehicle details saved"],
  ["driver_checklist", "equipment", "Equipment saved"],
  ["driver_checklist", "services", "Services saved"],
  ["driver_checklist", "agreement", "Agreement signed"],
  ["driver_checklist", "training", "Training finished"],
  ["driver_approved", "approve_active", "Approved as active"],
  ["driver_online", "online", "First time Online"],
  ["driver_claim", "claim", "First claim"],
] as const;

export default function FunnelPage({ searchParams }: PageProps<"/admin/funnel">) {
  return (
    <Suspense fallback={<LoadingMain />}>
      <FunnelContent searchParams={searchParams} />
    </Suspense>
  );
}

async function FunnelContent({
  searchParams,
}: {
  searchParams: PageProps<"/admin/funnel">["searchParams"];
}) {
  await requireAdmin("/admin/funnel");
  const query = await searchParams;
  const from = typeof query.from === "string" && /^\d{4}-\d{2}-\d{2}$/.test(query.from) ? query.from : "2026-10-01";
  const to = typeof query.to === "string" && /^\d{4}-\d{2}-\d{2}$/.test(query.to) ? query.to : "2026-10-31";
  const source = typeof query.source === "string" ? query.source.replace(/[^a-z0-9_-]/g, "").slice(0, 40) : "";
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_funnel", {
    range_start: from,
    range_end: to,
    source_filter: source,
  });
  const rows = (data ?? []) as { event_name: string; step: string; sessions: number }[];
  const count = (event: string, step: string) =>
    Number(rows.find((row) => row.event_name === event && row.step === step)?.sessions ?? 0);

  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-4 py-8">
      <p className="text-sm font-semibold tracking-wide text-brand uppercase">Admin</p>
      <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight text-ink">Funnel</h1>
      <p className="mt-2 text-base text-muted">Counts are distinct sessions. Raw events are kept for 90 days.</p>
      <Link href="/admin" className="mt-4 inline-flex min-h-12 items-center font-semibold text-brand">
        Overview
      </Link>
      <form className="mt-6 grid gap-3" method="get">
        <label className="font-semibold" htmlFor="from">
          From
          <input id="from" name="from" type="date" defaultValue={from} className="mt-2 min-h-12 w-full rounded-2xl border border-line px-4" />
        </label>
        <label className="font-semibold" htmlFor="to">
          To
          <input id="to" name="to" type="date" defaultValue={to} className="mt-2 min-h-12 w-full rounded-2xl border border-line px-4" />
        </label>
        <label className="font-semibold" htmlFor="source">
          Source
          <input id="source" name="source" defaultValue={source} placeholder="nextdoor" className="mt-2 min-h-12 w-full rounded-2xl border border-line px-4" />
        </label>
        <button type="submit" className="inline-flex min-h-12 items-center justify-center rounded-full bg-brand px-6 font-semibold text-white">
          Update
        </button>
      </form>
      {error ? (
        <p role="alert" className="mt-4 text-base text-danger">
          {error.message}
        </p>
      ) : (
        <table className="mt-6 w-full text-left text-base">
          <thead>
            <tr>
              <th className="py-2">Step</th>
              <th className="py-2">Sessions</th>
              <th className="py-2">Drop-off</th>
            </tr>
          </thead>
          <tbody>
            {order.map(([event, step, label], index) => {
              const sessions = count(event, step);
              const previous = index === 0 ? sessions : count(order[index - 1][0], order[index - 1][1]);
              const drop = Math.max(previous - sessions, 0);
              return (
                <tr key={`${event}-${step}`} className="border-t border-line">
                  <td className="py-3">{label}</td>
                  <td>{sessions}</td>
                  <td>{index === 0 ? "—" : drop}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </main>
  );
}
