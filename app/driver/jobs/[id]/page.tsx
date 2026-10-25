import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { BackLink } from "@/components/back-link";
import { AdvanceButton } from "@/components/driver/advance-button";
import { LoadingMain } from "@/components/loading-main";
import { AreaMap } from "@/components/maps/area-map";
import { RouteSketch } from "@/components/mobile/route-sketch";
import { StatusPill } from "@/components/mobile/status-pill";
import { JobTrackerView } from "@/components/request/job-tracker";
import { ProofForm } from "@/components/driver/proof-form";
import { ProofGallery } from "@/components/request/proof-gallery";
import { ReportForm } from "@/components/request/report-form";
import { ReviewPanel } from "@/components/reviews/review-panel";
import { JobMessages } from "@/components/messages/job-messages";
import { statusLabel } from "@/components/request/job-status";
import { requireSignedIn } from "@/lib/auth/session";
import { buildJobTracker, customerProgress, nextDriverAction } from "@/lib/jobs/tracker";
import { formatCents } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Assigned job",
};

export default function DriverJobPage({ params, searchParams }: PageProps<"/driver/jobs/[id]">) {
  return (
    <Suspense fallback={<LoadingMain />}>
      <DriverJob params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function DriverJob({
  params,
  searchParams,
}: {
  params: PageProps<"/driver/jobs/[id]">["params"];
  searchParams: PageProps<"/driver/jobs/[id]">["searchParams"];
}) {
  const session = await requireSignedIn("/driver/jobs");
  if (session.role !== "driver") notFound();
  const { id } = await params;
  const query = await searchParams;
  const supabase = await createClient();
  const { data: job } = await supabase
    .from("jobs")
    .select(
      "id, service, status, created_at, pricing_method, pickup_area, dropoff_area, driver_pay_cents, platform_fee_cents, commission_bps, payment_status, payment_due_at, dump_fee_cents, rejection_reason, trip_fee_cents",
    )
    .eq("id", id)
    .maybeSingle();
  if (!job) notFound();
  const [{ data: details }, { data: events }, { data: receipts }] = await Promise.all([
    supabase
      .from("job_private")
      .select("customer_name, pickup_address, dropoff_address, access_notes, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng")
      .eq("job_id", id)
      .maybeSingle(),
    supabase.from("job_events").select("type, created_at, data").eq("job_id", id).order("created_at"),
    supabase.from("job_photos").select("id").eq("job_id", id).eq("stage", "dump_receipt").limit(1),
  ]);
  const { data: ledger } =
    job.status === "completed"
      ? await supabase
          .from("ledger_entries")
          .select("amount_cents, status")
          .eq("job_id", id)
          .eq("driver_id", session.userId)
          .maybeSingle()
      : { data: null };
  const tracker = buildJobTracker({
    service: job.service,
    status: job.status,
    pricingMethod: job.pricing_method,
    paymentStatus: job.payment_status,
    createdAt: job.created_at,
    dumpFeeCents: job.dump_fee_cents,
    hasDumpReceipt: (receipts ?? []).length > 0,
    events: (events ?? []).map((event) => {
      const data = event.data as { to?: string } | null;
      return {
        type: event.type,
        createdAt: event.created_at,
        toStatus: typeof data?.to === "string" ? data.to : null,
      };
    }),
  });
  const { data: settings } = await supabase
    .from("platform_settings")
    .select("proof_location_enabled")
    .eq("id", 1)
    .maybeSingle();
  const next = nextDriverAction({
    status: job.status,
    paymentStatus: job.payment_status,
    service: job.service,
  });

  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-4 py-8">
      <BackLink href="/driver" label="Driver home" />
      <p className="text-sm font-semibold tracking-wide text-brand uppercase">Assigned job</p>
      <div className="mt-3">
        {details?.pickup_lat != null && details.pickup_lng != null ? (
          <AreaMap
            caption="Pickup and drop-off"
            pins={[
              { lat: details.pickup_lat, lng: details.pickup_lng, label: "Pickup" },
              ...(details.dropoff_lat != null && details.dropoff_lng != null
                ? [{ lat: details.dropoff_lat, lng: details.dropoff_lng, label: "Drop-off" }]
                : []),
            ]}
          />
        ) : (
          <RouteSketch from={job.pickup_area} to={job.dropoff_area} updated={tracker.lastUpdate} />
        )}
      </div>
      <div className="mt-4 flex items-center justify-between gap-3">
        <StatusPill status={job.status} />
      </div>
      <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight text-ink">
        {statusLabel(job.status)}
      </h1>
      <p className="mt-2 text-base text-muted">{job.service}</p>
      {job.driver_pay_cents != null ? (
        <div>
          <p className="font-semibold">Your earnings {formatCents(job.driver_pay_cents)}</p>
          {job.platform_fee_cents != null ? (
            <p>Offer {formatCents(job.driver_pay_cents + job.platform_fee_cents)} · Pickuply commission {formatCents(job.platform_fee_cents)}{job.commission_bps != null ? ` (${job.commission_bps / 100}%)` : ""}</p>
          ) : null}
        </div>
      ) : null}
      {job.payment_status ? <p>Payment: {job.payment_status.replaceAll("_", " ")}</p> : null}
      {job.status === "assigned" && !["authorized", "paid", "captured"].includes(job.payment_status ?? "") ? (
        <p>Waiting for customer payment</p>
      ) : null}
      {job.status === "assigned" && ["authorized", "paid", "captured"].includes(job.payment_status ?? "") ? (
        <p>Payment secured — you can start the trip.</p>
      ) : null}
      {job.payment_due_at && !["authorized", "paid", "captured"].includes(job.payment_status ?? "") ? (
        <p>Payment due {new Date(job.payment_due_at).toLocaleString()}. Work cannot start until it is paid.</p>
      ) : null}
      {details ? (
        <section className="mt-6 space-y-2 text-base text-ink">
          <h2 className="text-lg font-semibold">Pickup details</h2>
          <p>{details.customer_name}</p>
          <p>{details.pickup_address}</p>
          {details.dropoff_address ? <p>Drop-off: {details.dropoff_address}</p> : null}
          {details.access_notes ? <p>Access: {details.access_notes}</p> : null}
        </section>
      ) : (
        <p className="mt-6 text-base text-muted">The street address appears after you are assigned.</p>
      )}
      <p className="mt-4 text-base text-muted">
        Area only: {job.pickup_area}
        {job.dropoff_area ? ` to ${job.dropoff_area}` : ""}
      </p>
      {job.service === "junk" ? (
        <p className="mt-3 text-base text-ink">Your earnings must cover disposal fees.</p>
      ) : null}
      <JobTrackerView
        tracker={tracker}
        progress={customerProgress({
          status: job.status,
          paymentStatus: job.payment_status,
          service: job.service,
          pricingMethod: job.pricing_method,
          events: tracker.steps.length
            ? (events ?? []).map((event) => {
                const data = event.data as { to?: string } | null;
                return {
                  type: event.type,
                  createdAt: event.created_at,
                  toStatus: typeof data?.to === "string" ? data.to : null,
                };
              })
            : [],
        })}
      />
      {query.error === "step" ? (
        <p role="alert" className="mt-4 text-base text-danger">
          That step is not available yet.
        </p>
      ) : null}
      {query.error === "photo" ? (
        <p role="alert" className="mt-4 text-base text-danger">
          Add the item photo before sending it to the customer.
        </p>
      ) : null}
      {job.status === "cancelled" && job.rejection_reason ? (
        <p className="mt-4 text-base text-ink">
          The customer rejected the item. The trip fee
          {job.trip_fee_cents != null ? ` of ${formatCents(job.trip_fee_cents)}` : ""} is recorded by the existing payment rules.
        </p>
      ) : null}
      {job.status === "completed" && ledger && !["recovery_due", "recovered"].includes(ledger.status) ? (
        <p className="mt-4 text-base font-semibold text-ink">
          Earnings for this job {formatCents(ledger.amount_cents)}
        </p>
      ) : null}
      {job.status === "completed" ? (
        <ReviewPanel jobId={job.id} userId={session.userId} nextPath={`/driver/jobs/${job.id}`} />
      ) : null}
      {next.nextStatus ? (
        <div className="mt-4 grid gap-3">
          <AdvanceButton jobId={job.id} nextStatus={next.nextStatus} label={next.label} />
          {job.status === "assigned" && details?.pickup_address ? (
            <MapsLink address={details.pickup_address} label="Open in Maps" />
          ) : null}
          {job.status === "in_transit" && details?.dropoff_address ? (
            <MapsLink address={details.dropoff_address} label="Open in Maps" />
          ) : null}
        </div>
      ) : next.waiting ? (
        <button
          type="button"
          disabled
          className="mt-4 inline-flex min-h-14 w-full items-center justify-center rounded-full bg-brand px-6 text-lg font-semibold text-white disabled:opacity-60"
        >
          {next.label}
        </button>
      ) : null}
      <ProofGallery jobId={job.id} />
      <ProofForm jobId={job.id} locationEnabled={Boolean(settings?.proof_location_enabled)} />
      {["assigned", "en_route", "arrived", "item_check", "in_transit", "delivered", "completed", "disputed"].includes(job.status) ? (
        <ReportForm jobId={job.id} />
      ) : null}
      <div id="messages">
        <JobMessages jobId={job.id} showQuickReplies />
      </div>
      <p className="mt-4">
        <Link href="/support" className="inline-flex min-h-12 items-center font-semibold text-brand">
          Help
        </Link>
      </p>
      <Link href="/driver" className="mt-6 inline-flex min-h-12 items-center font-semibold text-brand">
        Driver home
      </Link>
    </main>
  );
}

function MapsLink({ address, label }: { address: string; label: string }) {
  const href = `https://maps.google.com/maps?q=${encodeURIComponent(address)}`;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex min-h-12 items-center justify-center rounded-full bg-paper px-6 font-semibold text-ink ring-1 ring-line"
    >
      {label}
    </a>
  );
}
