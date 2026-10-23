import Link from "next/link";
import { respondToQuote } from "@/app/jobs/actions";
import { takenJobMessage } from "@/lib/jobs/taken-message";
import { QuoteViewed } from "@/components/request/quote-viewed";
import { RouteSketch } from "@/components/mobile/route-sketch";
import { StatusPill } from "@/components/mobile/status-pill";
import { JobTrackerView } from "@/components/request/job-tracker";
import {
  fees,
  hearAboutOptions,
  itemSizes,
  junkLoadSizes,
  pricingMethods,
  serviceById,
  timeWindows,
  valueApprovalWarning,
  type ServiceId,
} from "@/lib/constants";
import type { DriverCard } from "@/lib/data/driver-card";
import type { QuoteNotice } from "@/lib/data/quote";
import type { JobDetail } from "@/lib/data/job-queries";
import { shortJobId } from "@/lib/jobs/next-action";
import { customerProgress, type JobTracker } from "@/lib/jobs/tracker";
import { formatCents } from "@/lib/money";

const statusLabels: Record<string, string> = {
  requested: "Requested",
  in_review: "In review",
  quoted: "Quoted",
  open: "Open for drivers",
  assigned: "Driver assigned",
  en_route: "Driver on the way",
  arrived: "Driver arrived",
  item_check: "Item check",
  in_transit: "On the way",
  delivered: "Delivered",
  completed: "Completed",
  cancelled: "Cancelled",
  disputed: "Disputed",
};

export function statusLabel(status: string): string {
  return statusLabels[status] ?? status;
}

export function JobStatus({
  job,
  notice,
  canRespond = false,
  error,
  tracker,
  driver,
}: {
  job: JobDetail;
  notice?: QuoteNotice | null;
  canRespond?: boolean;
  error?: string;
  tracker: JobTracker;
  driver?: DriverCard | null;
}) {
  const service = serviceById(job.service as ServiceId);
  const pricing = pricingMethods.find((method) => method.id === job.pricing_method);

  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-4 py-6">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold tracking-wide text-brand uppercase">Your request</p>
        <p className="text-sm font-semibold text-muted">#{shortJobId(job.id)}</p>
      </div>
      <div className="mt-3">
        <RouteSketch from={job.pickup_area} to={job.dropoff_area} updated={tracker.lastUpdate} />
      </div>
      <div className="mt-4">
        <StatusPill status={job.status} />
      </div>
      <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight text-ink">
        {statusLabel(job.status)}
      </h1>
      <p className="mt-2 text-lg text-ink">{service.name}</p>
      <JobTrackerView
        tracker={tracker}
        driver={driver}
        chatHref={driver ? "#messages" : undefined}
        progress={customerProgress({
          status: job.status,
          paymentStatus: job.payment_status,
          service: job.service,
          pricingMethod: job.pricing_method,
          events: job.events.map((event) => ({
            type: event.type,
            createdAt: event.created_at,
            toStatus: event.to_status,
          })),
        })}
      />
      <section className="mt-6 grid gap-2 rounded-3xl bg-paper-raised p-4 ring-1 ring-line">
        <h2 className="text-lg font-semibold text-ink">Request</h2>
        <p>{job.description}</p>
        <p>
          {job.pieces} pieces · {labelOf(itemSizes, job.size)}
        </p>
        <p>Pickup area: {job.pickup_area}</p>
        {job.dropoff_area ? <p>Drop-off area: {job.dropoff_area}</p> : <p>No drop-off.</p>}
        {job.junk_load_size ? <p>Load size: {labelOf(junkLoadSizes, job.junk_load_size)}</p> : null}
        <p>{pricing?.label ?? job.pricing_method}</p>
        {job.pricing_method === "fixed" && job.offer_cents != null ? (
          <p>Your price: {formatCents(job.offer_cents)}</p>
        ) : null}
        {job.pricing_method === "range" && job.budget_min_cents != null && job.budget_max_cents != null ? (
          <p>
            Your budget: {formatCents(job.budget_min_cents)}–{formatCents(job.budget_max_cents)}
          </p>
        ) : null}
        {job.pricing_method === "quote" ? <p>We&apos;ll send a price before drivers can see this.</p> : null}
        {job.pricing_method === "fixed" || job.pricing_method === "range" ? (
          <p>You choose a driver before anything is booked.</p>
        ) : null}
        {job.price_cents != null ? <p>Total: {formatCents(job.price_cents)}</p> : null}
        {job.source ? <p>{labelOf(hearAboutOptions, job.source)}</p> : null}
        <p>
          {job.preferred_date === "asap"
            ? "ASAP"
            : job.preferred_date === "today"
              ? "Today"
              : job.preferred_date}
          {job.time_window ? ` · ${labelOf(timeWindows, job.time_window)}` : ""}
        </p>
        {job.needs_value_approval ? <p>{valueApprovalWarning}</p> : null}
      </section>
      {job.private ? (
        <section className="mt-4 grid gap-2 rounded-3xl bg-paper-raised p-4 ring-1 ring-line">
          <h2 className="text-lg font-semibold text-ink">Private details</h2>
          <p>{job.private.customer_name}</p>
          <p>{job.private.customer_phone}</p>
          {job.private.customer_email ? <p>{job.private.customer_email}</p> : null}
          <p>Pickup: {job.private.pickup_address}</p>
          {job.private.dropoff_address ? <p>Drop-off: {job.private.dropoff_address}</p> : null}
          {job.private.access_notes ? <p>{job.private.access_notes}</p> : null}
        </section>
      ) : null}
      {job.photos.length > 0 ? (
        <ul className="mt-4 grid grid-cols-3 gap-2">
          {job.photos.map((photo) => (
            <li key={photo.id}>
              {/* Signed URL. It expires and is not a public file address. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photo.url} alt="" className="aspect-square w-full rounded-2xl object-cover" />
            </li>
          ))}
        </ul>
      ) : null}
      {error ? (
        <p role="alert" className="mt-4 text-base text-danger">
          {takenJobMessage(error)}
        </p>
      ) : null}
      {notice?.adminNote ? (
        <p className="mt-4 rounded-2xl bg-paper-raised p-4 text-base ring-1 ring-line">{notice.adminNote}</p>
      ) : null}
      {notice?.quote && canRespond ? (
        <section className="mt-4 space-y-2 rounded-3xl bg-paper-raised p-4 ring-1 ring-line">
          <QuoteViewed service={job.service} />
          <h2 className="text-lg font-semibold text-ink">Your quote</h2>
          <p>Subtotal {formatCents(notice.quote.driverPayCents + notice.quote.platformFeeCents)}</p>
          <p>Service fee {formatCents(notice.quote.serviceFeeCents)}</p>
          <p className="font-semibold">Total {formatCents(notice.quote.totalCents)}</p>
          <p>Expires {new Date(notice.quote.expiresAt).toLocaleString()}</p>
          <p>
            Cancel after a driver is assigned: {formatCents(fees.lateCancelFeeCents)}. Reject the item
            at pickup: {formatCents(fees.tripFeeCents)}. Damage coverage limit{" "}
            {formatCents(fees.damageCoverageLimitCents)}.
          </p>
          <p>Accepting publishes the job. It does not assign a driver and it does not charge your card.</p>
          <form action={respondToQuote} className="grid gap-3 pt-2">
            <input type="hidden" name="jobId" value={job.id} />
            <button
              type="submit"
              name="decision"
              value="accept"
              className="inline-flex min-h-12 items-center justify-center rounded-full bg-brand font-semibold text-white"
            >
              Accept quote
            </button>
            <button
              type="submit"
              name="decision"
              value="decline"
              className="inline-flex min-h-12 items-center justify-center rounded-full bg-paper font-semibold text-ink ring-1 ring-line"
            >
              Decline quote
            </button>
          </form>
        </section>
      ) : null}
      <p className="mt-6">
        <Link href="/account" className="font-semibold text-brand">
          Back to your requests
        </Link>
      </p>
    </main>
  );
}

export function JobMissing() {
  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-4 py-10">
      <h1 className="font-display text-4xl font-semibold text-ink">Request not found</h1>
      <p className="mt-4 text-lg text-muted">This request isn&apos;t available.</p>
      <p className="mt-6">
        <Link href="/account" className="font-semibold text-brand">
          Your requests
        </Link>
      </p>
    </main>
  );
}

function labelOf(options: readonly { id: string; label: string }[], id: string): string {
  return options.find((option) => option.id === id)?.label ?? id;
}
