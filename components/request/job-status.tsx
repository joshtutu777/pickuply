import Link from "next/link";
import {
  hearAboutOptions,
  itemSizes,
  junkLoadSizes,
  pricingMethods,
  serviceById,
  timeWindows,
  valueApprovalWarning,
  type ServiceId,
} from "@/lib/constants";
import type { JobDetail } from "@/lib/data/job-queries";
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

const timeline = [
  "requested",
  "quoted",
  "open",
  "assigned",
  "item_check",
  "delivered",
  "completed",
] as const;

export function statusLabel(status: string): string {
  return statusLabels[status] ?? status;
}

export function JobStatus({ job }: { job: JobDetail }) {
  const service = serviceById(job.service as ServiceId);
  const pricing = pricingMethods.find((method) => method.id === job.pricing_method);
  const current = timeline.indexOf(job.status as (typeof timeline)[number]);

  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-4 py-6">
      <p className="text-sm font-semibold tracking-wide text-brand uppercase">Your request</p>
      <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight text-ink">
        {statusLabel(job.status)}
      </h1>
      <p className="mt-2 text-lg text-ink">{service.name}</p>
      {job.status === "requested" ? (
        <p className="mt-2 text-base leading-relaxed text-muted">
          Drivers cannot see this yet. Nothing is booked or assigned. A quote waits for a price and
          your acceptance. A named price or budget waits for confirmation before a driver is chosen.
        </p>
      ) : null}
      <ol className="mt-6 grid gap-2">
        {timeline.map((status, index) => (
          <li
            key={status}
            aria-current={status === job.status ? "step" : undefined}
            className={`flex min-h-12 items-center rounded-2xl px-4 text-base font-semibold ${
              index === current
                ? "bg-brand text-white"
                : "bg-paper-raised text-muted ring-1 ring-line"
            }`}
          >
            {statusLabel(status)}
          </li>
        ))}
      </ol>
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
      {job.events.length > 0 ? (
        <section className="mt-4 grid gap-2">
          <h2 className="text-lg font-semibold text-ink">Updates</h2>
          <ul className="grid gap-2">
            {job.events.map((event) => (
              <li key={event.id} className="rounded-2xl bg-paper-raised px-4 py-3 ring-1 ring-line">
                <p className="font-semibold text-ink">
                  {event.to_status ? statusLabel(event.to_status) : event.type}
                </p>
                <p className="text-sm text-muted">{new Date(event.created_at).toLocaleString()}</p>
              </li>
            ))}
          </ul>
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
