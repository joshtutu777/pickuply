import type { Metadata } from "next";
import { Suspense } from "react";
import { cancelSmsCampaign, updateSmsCampaign } from "@/app/admin/sms/actions";
import { SmsSectionNav } from "@/components/admin/sms-section";
import { LoadingMain } from "@/components/loading-main";
import { requireAdmin } from "@/lib/auth/session";
import { audienceRule, type SmsAudience } from "@/lib/sms/center";
import { createClient } from "@/lib/supabase/server";
import { formatUsWhen } from "@/lib/time/when";

export const metadata: Metadata = { title: { absolute: "Scheduled texts · Pickuply Admin" } };
const field = "mt-2 min-h-12 w-full rounded-2xl border border-line bg-paper px-4";

export default function ScheduledPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <Suspense fallback={<LoadingMain />}>
      <Scheduled searchParams={searchParams} />
    </Suspense>
  );
}

function rule(value: unknown): string {
  const audience = value as SmsAudience | null;
  if (!audience || typeof audience !== "object" || !("kind" in audience)) return "Chosen audience";
  return audienceRule(audience);
}

async function Scheduled({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdmin("/admin/sms/scheduled");
  const query = await searchParams;
  const error = typeof query.error === "string" ? query.error : "";
  const supabase = await createClient();
  const { data, error: loadError } = await supabase
    .from("sms_campaigns")
    .select("id, body, purpose, audience, status, scheduled_for, estimated_count")
    .in("status", ["scheduled", "sending"])
    .order("scheduled_for", { ascending: true })
    .limit(30);
  const rows = data ?? [];

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
      <p className="text-sm font-semibold tracking-wide text-brand uppercase">Admin</p>
      <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight text-ink">Scheduled</h1>
      <p className="mt-3 text-base text-ink">Times are Eastern. Online drivers are counted again at send time. Cancel a text before that time to stop it.</p>
      <SmsSectionNav current="scheduled" />
      {error ? <p role="alert" className="mt-4 text-base text-danger">{error}</p> : null}
      {query.saved === "morning" ? (
        <p className="mt-4 text-base font-semibold text-ink">This text is scheduled. It waits until the Eastern time you confirmed.</p>
      ) : query.saved ? (
        <p className="mt-4 text-base font-semibold text-ink">Saved.</p>
      ) : null}
      {loadError ? <p role="alert" className="mt-4 text-base text-danger">Scheduled texts could not be loaded.</p> : null}
      {!loadError && rows.length === 0 ? <p className="mt-6 text-base text-muted">Nothing is waiting.</p> : null}
      <ul className="mt-4 grid gap-4">
        {rows.map((row) => (
          <li key={row.id} className="rounded-3xl bg-paper-raised p-4 ring-1 ring-line">
            <p className="font-semibold text-ink">{row.status === "sending" ? "Sending" : formatUsWhen(row.scheduled_for)}</p>
            <p className="mt-1 text-sm text-muted">{rule(row.audience)} · about {row.estimated_count ?? 0} when it was saved · {row.purpose}</p>
            <p className="mt-2 text-base text-ink">{row.body}</p>
            {row.status === "scheduled" ? (
              <div className="mt-3 grid gap-3">
                <form action={updateSmsCampaign} className="grid gap-2">
                  <input type="hidden" name="id" value={row.id} />
                  <input type="hidden" name="purpose" value={row.purpose} />
                  <input type="hidden" name="delivery" value="later" />
                  <label className="font-semibold text-ink">Message<textarea name="body" required defaultValue={row.body} className={`${field} min-h-24 py-3`} /></label>
                  <label className="font-semibold text-ink">Eastern date<input name="date" type="date" required className={field} /></label>
                  <label className="font-semibold text-ink">Eastern time<input name="time" type="time" required className={field} /></label>
                  <button type="submit" className="inline-flex min-h-12 items-center font-semibold text-brand">Save changes</button>
                </form>
                <form action={cancelSmsCampaign}>
                  <input type="hidden" name="id" value={row.id} />
                  <button type="submit" className="inline-flex min-h-12 items-center font-semibold text-danger">Cancel</button>
                </form>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </main>
  );
}
