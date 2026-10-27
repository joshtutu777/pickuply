import type { ReactNode } from "react";
import Link from "next/link";
import { respondToQuote } from "@/app/jobs/actions";
import { takenJobMessage } from "@/lib/jobs/taken-message";
import { DetailsFold } from "@/components/details-fold";
import { ScreenTabs } from "@/components/ui/screen-tabs";
import { PhotoThumb } from "@/components/ui/photo-thumb";
import { deliveryStages } from "@/lib/jobs/delivery-timeline";
import { formatUsDay, formatUsWhen } from "@/lib/time/when";
import { QuoteViewed } from "@/components/request/quote-viewed";
import { AreaMap } from "@/components/maps/area-map";
import { RouteSketch } from "@/components/mobile/route-sketch";
import { tripLabel } from "@/lib/maps/miles";
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
import { quoteRequestCopy } from "@/lib/jobs/quote-status";
import { customerProgress, customerStageLine, customerStatusDetail, type JobTracker } from "@/lib/jobs/tracker";
import { formatCents } from "@/lib/money";

const statusLabels: Record<string, string> = {
  requested: "Requested",
  in_review: "In review",
  quoted: "Quoted",
  open: "Open for drivers",
  assigned: "Driver assigned",
  en_route: "Driver on the way",
  arrived: "Driver arrived",
  item_check: "Item loaded",
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
  routeLine,
  review,
  offers,
  support,
  footer,
  children,
}: {
  job: JobDetail;
  notice?: QuoteNotice | null;
  canRespond?: boolean;
  error?: string;
  tracker: JobTracker;
  driver?: DriverCard | null;
  routeLine?: [number, number][];
  review?: ReactNode;
  offers?: ReactNode;
  support?: ReactNode;
  footer?: ReactNode;
  children?: ReactNode;
}) {
  const service = serviceById(job.service as ServiceId);
  const pricing = pricingMethods.find((method) => method.id === job.pricing_method);
  const booked = ["assigned", "en_route", "arrived", "item_check", "in_transit", "delivered", "completed", "disputed"].includes(
    job.status,
  );
  const stage = customerStageLine({
    status: job.status,
    paymentStatus: job.payment_status,
    driverName: driver?.firstName ?? null,
    dropoffArrived: job.dropoff_arrived_at != null,
    service: job.service,
  });

  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold tracking-wide text-brand uppercase">Your request</p>
        <p className="text-sm font-semibold text-muted">#{shortJobId(job.id)}</p>
      </div>
      <p className="mt-1 text-lg font-semibold text-ink">{service.name}</p>
      <div className="mt-2">
        <StatusPill status={job.status} />
      </div>
      <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight text-ink">
        {job.status === "completed"
          ? job.service === "junk"
            ? "Removal complete"
            : "Delivery complete"
          : job.status === "delivered"
            ? "Awaiting confirmation"
            : statusLabel(job.status)}
      </h1>
      <p className="mt-1 text-base text-ink">
        {job.pickup_area}
        {job.dropoff_area ? ` → ${job.dropoff_area}` : ""}
      </p>
      {job.price_cents != null ? <p className="mt-1 font-semibold text-ink">Total {formatCents(job.price_cents)}</p> : null}
      {job.service_fee_cents != null && job.service_fee_cents > 0 ? (
        <p className="text-sm text-ink">Card processing fee {formatCents(job.service_fee_cents)}</p>
      ) : null}
      {driver ? (
        <p className="text-base text-ink">
          Driver: {driver.firstName}{" "}
          <a href="#messages" className="inline-flex min-h-12 items-center font-semibold text-brand">
            Chat
          </a>
        </p>
      ) : null}
      {stage && job.status !== "completed" ? <p className="mt-1 text-base font-semibold text-ink">{stage}</p> : null}
      {job.status === "assigned" && !["authorized", "paid", "captured"].includes(job.payment_status ?? "") ? (
        <p className="mt-1 text-base text-ink">
          {customerStatusDetail({
            status: job.status,
            paymentStatus: job.payment_status,
            service: job.service,
            pricingMethod: job.pricing_method,
            dropoffArrived: job.dropoff_arrived_at != null,
          })}
        </p>
      ) : null}
      {job.status === "completed" ? (
        <p className="mt-2 inline-flex min-h-12 w-full items-center justify-center rounded-full bg-brand px-4 text-base font-semibold text-white">
          Delivery complete
        </p>
      ) : null}
      {review}
      {children}
      {error ? (
        <p role="alert" className="mt-3 text-base text-danger">
          {takenJobMessage(error)}
        </p>
      ) : null}
      {notice?.adminNote ? (
        <p className="mt-3 rounded-2xl bg-paper-raised p-4 text-base ring-1 ring-line">{notice.adminNote}</p>
      ) : null}
      {notice?.quote && canRespond ? (
        <section className="mt-3 space-y-2 rounded-3xl bg-paper-raised p-4 ring-1 ring-line">
          <QuoteViewed service={job.service} />
          <h2 className="text-lg font-semibold text-ink">Your quote</h2>
          <p>Offer {formatCents(notice.quote.driverPayCents + notice.quote.platformFeeCents)}</p>
          <p>Card processing fee {formatCents(notice.quote.serviceFeeCents)}</p>
          <p className="font-semibold">Total {formatCents(notice.quote.totalCents)}</p>
          <p>Expires {new Date(notice.quote.expiresAt).toLocaleString()}</p>
          <p>
            Cancel after a driver is assigned: {formatCents(fees.lateCancelFeeCents)}. Reject the item
            at pickup: {formatCents(fees.tripFeeCents)}.
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
      {!booked && (job.status === "open" || job.status === "quoted") ? (
        <a href="#job-offers" className="mt-3 inline-flex min-h-12 w-full items-center justify-center rounded-full bg-brand px-4 font-semibold text-white">
          View offers
        </a>
      ) : null}
      <ScreenTabs
        label="Job sections"
        initial={booked ? "progress" : "offers"}
        hashMap={{ "job-offers": "offers", messages: "details" }}
        tabs={[
          {
            id: "progress",
            label: "Progress",
            panel: (
              <div className="grid gap-2">
                {job.status === "disputed" ? (
                  <p className="text-base text-ink">Delivery paused while Pickuply reviews your report.</p>
                ) : null}
                <ol className="grid gap-1">
                  {deliveryStages(job.status, job.dropoff_arrived_at != null, job.service).map((step) => (
                    <li
                      key={step.label}
                      className={`flex min-h-10 items-center gap-2 text-base ${
                        step.state === "current" ? "font-semibold text-ink" : step.state === "done" ? "text-ink" : "text-muted"
                      }`}
                    >
                      <span aria-hidden="true">{step.state === "done" ? "✓" : step.state === "current" ? "●" : "○"}</span>
                      <span>
                        {step.label}
                        {step.state === "current" ? <span className="sr-only">, current step</span> : null}
                      </span>
                    </li>
                  ))}
                </ol>
                <DetailsFold title="Map">
                  {job.private?.pickup_lat != null && job.private.pickup_lng != null ? (
                    <AreaMap
                      caption={
                        job.private.pickup_verified === false || job.private.dropoff_verified === false
                          ? "Address not verified"
                          : "Route"
                      }
                      pins={[
                        { lat: job.private.pickup_lat, lng: job.private.pickup_lng, label: "Pickup" },
                        ...(job.private.dropoff_lat != null && job.private.dropoff_lng != null
                          ? [{ lat: job.private.dropoff_lat, lng: job.private.dropoff_lng, label: "Drop-off" }]
                          : []),
                      ]}
                      line={
                        routeLine && routeLine.length > 1
                          ? routeLine
                          : job.private.dropoff_lat != null && job.private.dropoff_lng != null
                            ? [
                                [job.private.pickup_lng, job.private.pickup_lat],
                                [job.private.dropoff_lng, job.private.dropoff_lat],
                              ]
                            : []
                      }
                    />
                  ) : (
                    <RouteSketch from={job.pickup_area} to={job.dropoff_area} updated={tracker.lastUpdate} />
                  )}
                  <p>Trip: {tripLabel(job.distance_miles, job.distance_source)}</p>
                </DetailsFold>
              </div>
            ),
          },
          {
            id: "offers",
            label: "Offers",
            panel: offers ?? <p className="text-base text-muted">No offers to review.</p>,
          },
          {
            id: "details",
            label: "Details",
            panel: (
              <div>
      <DetailsFold title="Job details">
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
        {job.pricing_method === "quote" ? (
          <p>
            {quoteRequestCopy({
              pricingMethod: job.pricing_method,
              status: job.status,
              paymentStatus: job.payment_status,
              service: job.service,
            })}
          </p>
        ) : null}
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
              : formatUsDay(job.preferred_date)}
          {job.time_window ? ` · ${labelOf(timeWindows, job.time_window)}` : ""}
        </p>
        {job.needs_value_approval ? <p>{valueApprovalWarning}</p> : null}
        {job.photos.length > 0 ? (
          <ul className="mt-2 flex gap-2">
            {job.photos.map((photo) => (
              <li key={photo.id}>
                <PhotoThumb src={photo.url} alt="Request photo" />
              </li>
            ))}
          </ul>
        ) : null}
      </DetailsFold>
      {job.private ? (
        <DetailsFold title="Pickup address" open={booked}>
          <p>{job.private.customer_name}</p>
          <p>{job.private.customer_phone}</p>
          {job.private.customer_email ? <p>{job.private.customer_email}</p> : null}
          <p>{job.private.pickup_address}</p>
          {job.private.access_notes ? <p>Access: {job.private.access_notes}</p> : null}
        </DetailsFold>
      ) : null}
      {job.private?.dropoff_address ? (
        <DetailsFold title="Drop-off address" open={booked}>
          <p>{job.private.dropoff_address}</p>
        </DetailsFold>
      ) : null}
      <DetailsFold title="Status history">
        <ul className="grid gap-1">
          {job.events.map((event) => (
            <li key={event.id}>
              {event.to_status ? statusLabel(event.to_status) : event.type} · {formatUsWhen(event.created_at)}
            </li>
          ))}
        </ul>
        <JobTrackerView
          tracker={tracker}
          driver={driver}
          chatHref={driver ? "#messages" : undefined}
          progress={customerProgress({
            status: job.status,
            paymentStatus: job.payment_status,
            dropoffArrived: job.dropoff_arrived_at != null,
            service: job.service,
            pricingMethod: job.pricing_method,
            events: job.events.map((event) => ({
              type: event.type,
              createdAt: event.created_at,
              toStatus: event.to_status,
            })),
          })}
        />
      </DetailsFold>
      <DetailsFold title="Support" open={booked}>
        {support}
      </DetailsFold>
              </div>
            ),
          },
        ]}
      />
      {footer}
      <p className="mt-3">
        <Link href="/account" className="inline-flex min-h-12 items-center font-semibold text-brand">
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
