import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { BackLink } from "@/components/back-link";
import { DetailsFold } from "@/components/details-fold";
import { AdvanceButton } from "@/components/driver/advance-button";
import { DriverActions } from "@/components/driver/driver-actions";
import { missingProofWarning } from "@/lib/jobs/proof-warning";
import { LoadingMain } from "@/components/loading-main";
import { AreaMap } from "@/components/maps/area-map";
import { RouteSketch } from "@/components/mobile/route-sketch";
import { StatusPill } from "@/components/mobile/status-pill";
import { JobTrackerView } from "@/components/request/job-tracker";
import { ProofForm } from "@/components/driver/proof-form";
import { NoShowWait } from "@/components/delivery/no-show-wait";
import { ProofGallery } from "@/components/request/proof-gallery";
import { ReviewPanel } from "@/components/reviews/review-panel";
import { JobStatusWatch } from "@/components/request/job-status-watch";
import { ScrollOnValue } from "@/components/scroll-restore";
import { JobMessageCard } from "@/components/messages/message-card";
import { JobMessages } from "@/components/messages/job-messages";
import { ScheduledPickup } from "@/components/jobs/scheduled-pickup";
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
      "id, service, status, created_at, pricing_method, pickup_area, dropoff_area, driver_pay_cents, platform_fee_cents, payment_status, payment_due_at, dump_fee_cents, rejection_reason, trip_fee_cents, test_retired_at, dropoff_arrived_at, no_show_pending, require_disposal_receipt, store_name, store_order_number, pickup_availability, scheduled_pickup_start, scheduled_pickup_end",
    )
    .eq("id", id)
    .maybeSingle();
  if (!job) notFound();
  const [{ data: details }, { data: events }, { data: proofRows }, { data: windows }] = await Promise.all([
    supabase
      .from("job_private")
      .select("customer_name, pickup_address, dropoff_address, access_notes, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng")
      .eq("job_id", id)
      .maybeSingle(),
    supabase.from("job_events").select("type, created_at, data").eq("job_id", id).order("created_at"),
    supabase.from("job_photos").select("stage").eq("job_id", id).is("report_id", null),
    supabase.from("job_pickup_windows").select("id, starts_at, ends_at, position").eq("job_id", id).order("position"),
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
    requireDisposalReceipt: job.require_disposal_receipt,
    hasDumpReceipt: (proofRows ?? []).some((row) => row.stage === "dump_receipt"),
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
  const disposalReceipt =
    job.service === "junk" && ((job.dump_fee_cents ?? 0) > 0 || job.require_disposal_receipt);
  const retired = job.test_retired_at != null;
  const needsProof = next.nextStatus === "item_check" || next.nextStatus === "delivered";
  const junk = job.service === "junk";
  const jobAmount = job.driver_pay_cents != null && job.platform_fee_cents != null
    ? job.driver_pay_cents + job.platform_fee_cents
    : null;
  const proofStages = new Set((proofRows ?? []).map((row) => row.stage));
  const proofWarning = next.nextStatus
    ? missingProofWarning({
        service: job.service,
        status: job.status,
        nextStatus: next.nextStatus,
        hasPickup: proofStages.has("pickup"),
        hasDropoff: proofStages.has("dropoff"),
        needsReceipt: disposalReceipt,
        hasReceipt: proofStages.has("dump_receipt"),
      })
    : null;
  const proofStage = proofWarning?.includes("disposal receipt")
    ? "dump_receipt"
    : next.nextStatus === "delivered" && job.status === "in_transit"
      ? "dropoff"
      : "pickup";
  const serverProofMessage =
    query.error === "dropoff"
      ? "Please upload a delivery photo or video before marking this job as Delivered."
      : query.error === "pickup"
        ? junk
          ? "Please upload a completion photo or video before marking this job as Junk removed."
          : "Please upload a pickup photo or video before marking the item as loaded."
        : query.error === "receipt"
          ? junk
            ? "Please upload the disposal receipt before marking this job as Junk removed."
            : "Please upload the disposal receipt before marking this job as Delivered."
          : query.error === "photo"
            ? "Add the required photo before this step."
            : null;

  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-4 py-3">
      <ScrollOnValue value={`${job.status}:${job.payment_status ?? ""}`} />
      <JobStatusWatch jobId={job.id} status={job.status} paymentStatus={job.payment_status} />
      <BackLink href="/driver/jobs" label="Jobs" />
      <div className="flex items-center justify-between gap-3">
        <StatusPill status={job.status} />
        <p className="text-sm font-semibold text-muted">{job.service.replaceAll("_", " ")}</p>
      </div>
      <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight text-ink">
        {job.status === "completed"
          ? junk
            ? "Removal complete"
            : "Delivery complete"
          : job.status === "delivered"
            ? "Awaiting customer confirmation"
            : statusLabel(job.status)}
      </h1>
      <p className="mt-1 text-base text-ink">
        {job.pickup_area}
        {job.dropoff_area ? ` to ${job.dropoff_area}` : ""}
      </p>
      {job.service === "construction" && job.store_name ? (
        <p className="text-base text-ink">Store: {job.store_name}</p>
      ) : null}
      {job.service === "construction" && job.store_order_number ? (
        <p className="text-base font-semibold text-ink">
          Store order / pickup number: {job.store_order_number}
        </p>
      ) : null}
      {details?.customer_name ? <p className="text-base text-ink">Customer: {details.customer_name.split(" ")[0]}</p> : null}
      <JobMessageCard jobId={job.id} audience="driver" />
      <ScheduledPickup
        availability={job.pickup_availability}
        start={job.scheduled_pickup_start}
        end={job.scheduled_pickup_end}
        windows={(windows ?? []).map((window) => ({
          id: window.id,
          starts_at: window.starts_at,
          ends_at: window.ends_at,
          position: window.position,
        }))}
        locked={job.scheduled_pickup_start != null}
      />
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
          {needsProof ? (
            <DriverActions
              jobId={job.id}
              nextStatus={next.nextStatus}
              label={next.label}
              service={job.service}
              status={job.status}
              hasPickup={proofStages.has("pickup")}
              hasDropoff={proofStages.has("dropoff")}
              needsReceipt={disposalReceipt}
              hasReceipt={proofStages.has("dump_receipt")}
              locationEnabled={Boolean(settings?.proof_location_enabled)}
              proofStage={proofStage}
            />
          ) : (
            <AdvanceButton jobId={job.id} nextStatus={next.nextStatus} label={next.label} />
          )}
          {disposalReceipt && next.nextStatus === "delivered" ? (
            <p className="text-base text-ink">
              {junk
                ? "Add the disposal receipt photo before marking the junk removed."
                : "Add the disposal receipt photo before marking this delivered."}
            </p>
          ) : null}
        </div>
      ) : !retired && job.status === "completed" ? (
        <p className="mt-3 inline-flex min-h-14 w-full items-center justify-center rounded-full bg-brand px-6 text-lg font-semibold text-white">
          {junk ? "Removal complete" : "Delivery complete"}
        </p>
      ) : !retired && job.status === "delivered" ? (
        <p className="mt-3 inline-flex min-h-14 w-full items-center justify-center rounded-full bg-paper px-6 text-lg font-semibold text-muted ring-1 ring-line">
          Awaiting customer confirmation
        </p>
      ) : !retired && next.waiting ? (
        <button
          type="button"
          disabled
          className="mt-3 inline-flex min-h-14 w-full items-center justify-center rounded-full bg-brand px-6 text-lg font-semibold text-white disabled:opacity-60"
        >
          {next.label}
        </button>
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
      {serverProofMessage ? (
        <p id="proof-needed" role="alert" className="mt-3 text-base text-danger">
          {serverProofMessage}
        </p>
      ) : null}
      {query.error === "noshow" ? (
        <p role="alert" className="mt-3 text-base text-danger">
          Add a photo of the wait, and wait 15 minutes after arrival. This does not charge a fee.
        </p>
      ) : null}
      {!retired && job.status === "in_transit" && job.dropoff_arrived_at && !job.no_show_pending ? (
        <ProofForm
          jobId={job.id}
          locationEnabled={Boolean(settings?.proof_location_enabled)}
          defaultStage="no_show"
          idPrefix="wait-"
          submitLabel="Save wait photo"
        />
      ) : null}
      <DetailsFold title="Route">
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
      </DetailsFold>
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
        <section className="mt-3 min-w-0 space-y-2 text-base text-ink">
          <h2 className="text-lg font-semibold">Addresses</h2>
          <p className="break-words">{details.pickup_address}</p>
          {details.dropoff_address ? <p className="break-words">Drop-off: {details.dropoff_address}</p> : null}
          {details.pickup_address ? (
            <MapsLink address={details.pickup_address} label="Open pickup in Maps" />
          ) : null}
          {details.dropoff_address ? (
            <MapsLink address={details.dropoff_address} label="Open drop-off in Maps" />
          ) : null}
          {details.customer_name || details.access_notes ? (
            <DetailsFold title="Notes">
              {details.customer_name ? <p>{details.customer_name}</p> : null}
              {details.access_notes ? <p>Access: {details.access_notes}</p> : null}
            </DetailsFold>
          ) : null}
        </section>
      ) : (
        <p className="mt-3 text-base text-muted">The street address appears after you are assigned.</p>
      )}
      {job.service === "junk" ? (
        <p className="mt-3 text-base text-ink">Your earnings must cover disposal fees.</p>
      ) : null}
      <DetailsFold title="History">
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
      </DetailsFold>
      {job.status === "cancelled" && job.rejection_reason ? (
        <p className="mt-4 text-base text-ink">
          The customer rejected the item.
          {job.trip_fee_cents != null && job.trip_fee_cents > 0
            ? ` The trip fee of ${formatCents(job.trip_fee_cents)} is recorded by the existing payment rules.`
            : " No trip fee was charged."}
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
      <DetailsFold title="Photos">
        <ProofGallery jobId={job.id} />
      </DetailsFold>
      <DetailsFold title="Messages" open>
        <div id="messages">
          <JobMessages jobId={job.id} showQuickReplies />
        </div>
      </DetailsFold>
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
