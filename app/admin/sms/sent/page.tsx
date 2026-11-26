import type { Metadata } from "next";
import { Suspense } from "react";
import { deliveryLabel, SmsSectionNav } from "@/components/admin/sms-section";
import { LoadingMain } from "@/components/loading-main";
import { requireAdmin } from "@/lib/auth/session";
import { audienceRule, type SmsAudience } from "@/lib/sms/center";
import { createClient } from "@/lib/supabase/server";
import { maskUsPhone } from "@/lib/phone";
import { formatUsWhen } from "@/lib/time/when";

export const metadata: Metadata = { title: { absolute: "Sent texts · Pickuply Admin" } };

export default function SentPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <Suspense fallback={<LoadingMain />}>
      <Sent searchParams={searchParams} />
    </Suspense>
  );
}

async function Sent({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdmin("/admin/sms/sent");
  const query = await searchParams;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("sms_campaigns")
    .select("id, body, purpose, audience, status, finished_at, scheduled_for, sent_count, failed_count, skipped_count, estimated_count")
    .in("status", ["sent", "failed", "canceled"])
    .order("created_at", { ascending: false })
    .limit(40);
  const rows = data ?? [];
  const { data: bookingTexts, error: bookingError } = await supabase
    .from("transactional_sms")
    .select("id, kind, body, status, skip_reason, error_code, to_phone, provider_sid, created_at, job_id")
    .order("created_at", { ascending: false })
    .limit(40);

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
      <p className="text-sm font-semibold tracking-wide text-brand uppercase">Admin</p>
      <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight text-ink">Sent</h1>
      <SmsSectionNav current="sent" />
      {query.saved ? <p className="mt-4 text-base font-semibold text-ink">The text was handed to the phone provider. Delivery can still take a moment.</p> : null}
      {error ? <p role="alert" className="mt-4 text-base text-danger">Sent texts could not be loaded.</p> : null}
      {!error && rows.length === 0 ? <p className="mt-6 text-base text-muted">No texts have been sent from here yet.</p> : null}
      <ul className="mt-4 grid gap-3">
        {rows.map((row) => (
            <li key={row.id} className="rounded-3xl bg-paper-raised p-4 ring-1 ring-line">
              <p className="font-semibold text-ink">{row.status}</p>
              <p className="mt-1 text-sm text-muted">
                {row.audience && typeof row.audience === "object" && "kind" in row.audience ? audienceRule(row.audience as SmsAudience) : "Chosen audience"} · accepted {row.sent_count ?? 0} · failed {row.failed_count ?? 0} · skipped {row.skipped_count ?? 0}
                {row.finished_at ? ` · ${formatUsWhen(row.finished_at)}` : ""}
              </p>
              <p className="mt-2 text-base text-ink">{row.body}</p>
            </li>
        ))}
      </ul>
      <h2 className="mt-10 font-display text-3xl font-semibold tracking-tight text-ink">Booking texts</h2>
      {bookingError ? <p role="alert" className="mt-4 text-base text-danger">Booking texts could not be loaded.</p> : null}
      {!bookingError && (bookingTexts ?? []).length === 0 ? <p className="mt-4 text-base text-muted">No booking texts yet.</p> : null}
      <ul className="mt-4 grid gap-3">
        {(bookingTexts ?? []).map((row) => (
          <li key={row.id} className="rounded-3xl bg-paper-raised p-4 ring-1 ring-line">
            <p className="font-semibold text-ink">{deliveryLabel(row.status)} · {row.kind}</p>
            <p className="mt-1 text-sm text-muted">
              {maskUsPhone(row.to_phone ?? "") ?? "No phone"}
              {row.skip_reason ? ` · ${row.skip_reason}` : ""}
              {row.error_code ? ` · ${row.error_code}` : ""}
              {row.provider_sid ? ` · ${row.provider_sid}` : ""}
              {` · ${formatUsWhen(row.created_at)}`}
            </p>
            <p className="mt-2 text-base text-ink">{row.body}</p>
          </li>
        ))}
      </ul>
    </main>
  );
}
