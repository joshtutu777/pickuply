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
import { NoShowWait } from "@/components/delivery/no-show-wait";
import { ReviewCountdown } from "@/components/delivery/review-countdown";
import { ProofGallery } from "@/components/request/proof-gallery";
import { ReviewPanel } from "@/components/reviews/review-panel";
import { ScrollOnValue } from "@/components/scroll-restore";
import { JobMessages } from "@/components/messages/job-messages";
import { statusLabel } from "@/components/request/job-status";
import { requireSignedIn } from "@/lib/auth/session";
import { buildJobTracker, customerProgress, nextDriverAction } from "@/lib/jobs/tracker";
import { formatCents } from "@/lib/money";
import { earningsAvailability } from "@/lib/payments/earnings";
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
      "id, service, status, created_at, pricing_method, pickup_area, dropoff_area, driver_pay_cents, platform_fee_cents, payment_status, payment_due_at, dump_fee_cents, rejection_reason, trip_fee_cents, test_retired_at, pickup_review_until, dropoff_arrived_at, no_show_pending, require_disposal_receipt",
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
    dropoffArrived: job.dropoff_arrived_at != null,
  });
  const retired = job.test_retired_at != null;
  const needsProof = next.nextStatus === "item_check" || next.nextStatus === "delivered";
  const jobAmount = job.driver_pay_cents != null && job.platform_fee_cents != null
    ? job.driver_pay_cents + job.platform_fee_cents
    : null;
  const proofStage = next.nextStatus === "delivered" ? "dropoff" : "pickup";

  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-4 py-4">
      <ScrollOnValue value={`${job.status}:${job.payment_status ?? ""}`} />
      <BackLink href="/driver/jobs" label="Jobs" />
      <div className="flex items-center justify-between gap-3">
        <StatusPill status={job.status} />
        <p className="text-sm font-semibold text-muted">{job.service.replaceAll("_", " ")}</p>
      </div>
      <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-ink">
        {statusLabel(job.status)}
      </h1>
      <p className="mt-1 text-base text-ink">
        {job.pickup_area}
        {job.dropoff_area ? ` to ${job.dropoff_area}` : ""}
      </p>
      {jobAmount != null && job.driver_pay_cents != null ? (
        <div className="mt-3">
          <p>Job Amount: {formatCents(jobAmount)}</p>
          <p className="font-semibold">Your Estimated Earnings: {formatCents(job.driver_pay_cents)}</p>
        </div>
      ) : job.driver_pay_cents != null ? (
        <p className="mt-3 font-semibold">Your Estimated Earnings: {formatCents(job.driver_pay_cents)}</p>
      ) : null}
      {job.payment_status ? <p className="mt-1">Payment: {job.payment_status.replaceAll("_", " ")}</p> : null}
      {retired ? <p className="mt-3 text-base text-ink">This job is closed.</p> : null}
      {!retired && next.nextStatus ? (
        <div className="sticky top-2 z-10 mt-3 grid gap-3 rounded-3xl bg-paper p-3 ring-1 ring-line">
          <AdvanceButton jobId={job.id} nextStatus={next.nextStatus} label={next.label} />
          {needsProof ? (
            <ProofForm jobId={job.id} locationEnabled={Boolean(settings?.proof_location_enabled)} defaultStage={proofStage} />
          ) : null}
          {job.service === "junk" && job.require_disposal_receipt && next.nextStatus === "delivered" ? (
            <p className="text-base text-ink">Add the disposal receipt photo before marking this delivered.</p>
          ) : null}
        </div>
      ) : !retired && next.waiting ? (
        <button
          type="button"
          disabled
          className="mt-3 inline-flex min-h-14 w-full items-center justify-center rounded-full bg-brand px-6 text-lg font-semibold text-white disabled:opacity-60"
        >
          {next.label}
        </button>
      ) : null}
      {!retired && job.status === "item_check" && job.pickup_review_until ? (
        <div className="mt-3">
          <ReviewCountdown jobId={job.id} until={job.pickup_review_until} />
        </div>
      ) : null}
      {!retired && job.status === "in_transit" && job.dropoff_arrived_at && !job.no_show_pending ? (
        <NoShowWait jobId={job.id} arrivedAt={job.dropoff_arrived_at} />
      ) : null}
      {job.no_show_pending ? (
        <p className="mt-3 text-base text-ink">
          Pickuply is reviewing the no-show. The job is not cancelled, and no fee has been charged.
        </p>
      ) : null}
      {query.error === "step" ? (
        <p role="alert" className="mt-3 text-base text-danger">
          That step is not available yet.
        </p>
      ) : null}
      {query.error === "payment" ? (
        <p role="alert" className="mt-3 text-base text-danger">
          The card has to be authorized before the trip can start.
        </p>
      ) : null}
      {query.error === "photo" ? (
        <p id="proof-needed" role="alert" className="mt-3 text-base text-danger">
          Add the required photo before this step.
        </p>
      ) : null}
      {query.error === "noshow" ? (
        <p role="alert" className="mt-3 text-base text-danger">
          Add a photo of the wait, and wait 15 minutes after arrival. This does not charge a fee.
        </p>
      ) : null}
      <div className="mt-4">
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
          {job.status === "assigned" && details.pickup_address ? (
            <MapsLink address={details.pickup_address} label="Open pickup in Maps" />
          ) : null}
          {job.status === "in_transit" && details.dropoff_address ? (
            <MapsLink address={details.dropoff_address} label="Open drop-off in Maps" />
          ) : null}
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
      {job.status === "cancelled" && job.rejection_reason ? (
        <p className="mt-4 text-base text-ink">
          The customer rejected the item. The trip fee
          {job.trip_fee_cents != null ? ` of ${formatCents(job.trip_fee_cents)}` : ""} is recorded by the existing payment rules.
        </p>
      ) : null}
      {job.status === "completed" && ledger && !["recovery_due", "recovered"].includes(ledger.status) ? (
        <div className="mt-4 rounded-3xl bg-paper-raised p-4 ring-1 ring-line">
          <p className="text-base font-semibold text-ink">
            Earnings for this job {formatCents(ledger.amount_cents)}
          </p>
          <p className="mt-1 text-base text-ink">Earnings status: {earningsAvailability(ledger.status).label}</p>
          <p className="mt-1 text-base text-ink">{earningsAvailability(ledger.status).detail}</p>
          <Link href="/driver/earnings" className="mt-2 inline-flex min-h-12 items-center font-semibold text-brand">
            Earnings and payouts
          </Link>
        </div>
      ) : null}
      {job.status === "completed" && !ledger ? (
        <p className="mt-4 text-base text-ink">
          Earnings for this job are still being recorded. They are not available to pay out yet.
        </p>
      ) : null}
      {job.status === "completed" ? (
        <ReviewPanel
          jobId={job.id}
          userId={session.userId}
          nextPath={`/driver/jobs/${job.id}`}
          skipHref="/driver"
        />
      ) : null}
      <ProofGallery jobId={job.id} />
      {!retired && job.status === "in_transit" && job.dropoff_arrived_at && !job.no_show_pending ? (
        <ProofForm
          jobId={job.id}
          locationEnabled={Boolean(settings?.proof_location_enabled)}
          defaultStage="no_show"
          idPrefix="wait-"
          submitLabel="Save wait photo"
        />
      ) : null}
      <div id="messages">
        <JobMessages jobId={job.id} showQuickReplies />
      </div>
      <p className="mt-4">
        <Link href={`/help?job=${job.id}#report`} className="inline-flex min-h-12 items-center font-semibold text-brand">
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
