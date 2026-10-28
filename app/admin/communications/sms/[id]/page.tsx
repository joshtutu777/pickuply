import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { cancelSmsCampaign, pauseSmsCampaign, resumeSmsCampaign } from "@/app/admin/communications/sms/actions";
import { deliveryStatusLabel } from "@/lib/communications/campaign";
import { LoadingMain } from "@/components/loading-main";
import { requireAdmin } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: { absolute: "SMS campaign · Pickuply Admin" } };

const reasons: Record<string, string> = {
  daily_limit: "Already received 3 promotional messages today",
  quiet_hours: "Waiting until 8:00 AM Eastern",
  texting_off: "Texting is off, so no text was sent",
};

export default function SmsCampaignPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return (
    <Suspense fallback={<LoadingMain />}>
      <Campaign params={params} />
    </Suspense>
  );
}

async function Campaign({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin("/admin/communications/sms");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createClient();
  const { data: campaign } = await supabase
    .from("sms_campaigns")
    .select("id, name, body, status, purpose, scheduled_for, estimated_phones, eligible_phones, audience_preview")
    .eq("id", id)
    .maybeSingle();
  if (!campaign) notFound();
  const { data: deliveries } = await supabase.rpc("sms_campaign_delivery_rows", { target: id });
  const rows = (deliveries ?? []) as {
    first_name: string;
    phone_last4: string;
    status: string;
    reason: string | null;
    segments: number;
    send_after: string | null;
  }[];
  const preview = campaign.audience_preview as {
    phones?: number;
    duplicatesRemoved?: number;
    ineligible?: number;
  } | null;

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
      <p className="text-sm font-semibold tracking-wide text-brand uppercase">Admin</p>
      <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight text-ink">{campaign.name}</h1>
      <p className="mt-3 text-base text-muted">
        {campaign.status === "sent" ? "Finished" : campaign.status} · {campaign.purpose === "account_support" ? "Account support" : "Marketing"}
      </p>
      <p className="mt-4 text-base text-ink">{campaign.body}</p>
      <p className="mt-3 text-base text-ink">
        {campaign.eligible_phones ?? preview?.phones ?? campaign.estimated_phones} phone numbers.
        {" "}{preview?.duplicatesRemoved ?? 0} duplicates removed.
        {" "}{preview?.ineligible ?? 0} ineligible.
      </p>
      <p className="mt-2 text-base text-ink">
        Finished means the scheduler recorded each person. It does not mean a phone received a text.
      </p>
      <p className="mt-3">
        <Link href="/admin/communications/sms" className="inline-flex min-h-12 items-center font-semibold text-brand">
          All campaigns
        </Link>
      </p>
      <div className="mt-4 flex flex-wrap gap-3">
        {campaign.status === "scheduled" || campaign.status === "sending" ? (
          <form action={pauseSmsCampaign}>
            <input type="hidden" name="id" value={campaign.id} />
            <button type="submit" className="inline-flex min-h-12 items-center font-semibold text-brand">Pause</button>
          </form>
        ) : null}
        {campaign.status === "paused" ? (
          <form action={resumeSmsCampaign}>
            <input type="hidden" name="id" value={campaign.id} />
            <button type="submit" className="inline-flex min-h-12 items-center font-semibold text-brand">Resume</button>
          </form>
        ) : null}
        {campaign.status === "draft" || campaign.status === "scheduled" || campaign.status === "paused" ? (
          <form action={cancelSmsCampaign}>
            <input type="hidden" name="id" value={campaign.id} />
            <button type="submit" className="inline-flex min-h-12 items-center font-semibold text-danger">Cancel</button>
          </form>
        ) : null}
      </div>
      <section className="mt-8">
        <h2 className="font-display text-2xl font-semibold text-ink">Delivery</h2>
        {rows.length === 0 ? <p className="mt-3 text-base text-muted">No delivery rows yet. A draft or a paused campaign has not been run.</p> : null}
        <ul className="mt-3 grid gap-3">
          {rows.map((row, index) => (
            <li key={`${row.phone_last4}-${row.first_name}-${index}`} className="rounded-3xl bg-paper-raised p-4 ring-1 ring-line">
              <p className="font-semibold text-ink">{row.first_name} · ···{row.phone_last4}</p>
              <p className="mt-1 text-base text-muted">
                {deliveryStatusLabel(row.status)} · {row.segments} {row.segments === 1 ? "segment" : "segments"}
                {row.reason ? ` · ${reasons[row.reason] ?? row.reason}` : ""}
              </p>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
