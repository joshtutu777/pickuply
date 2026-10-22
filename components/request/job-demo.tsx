"use client";

import { useEffect, useState } from "react";
import {
  demoSavedLabel,
  demoTimeline,
  hearAboutOptions,
  itemSizes,
  junkLoadSizes,
  pricingMethods,
  serviceById,
  timeWindows,
  valueApprovalWarning,
} from "@/lib/constants";
import { getRequest, getRequestPrivate } from "@/lib/data/requests";
import { formatCents } from "@/lib/money";
import { loadPhoto } from "@/lib/photo-store";
import type { PrivateJob, PublicJob } from "@/lib/types";

type Photo = { id: string; url: string };
type Status = "ready" | "missing" | "error";

function readJob(id: string): { status: Status; job: PublicJob | null; privateJob: PrivateJob | null } {
  try {
    const job = getRequest(id);
    if (!job) return { status: "missing", job: null, privateJob: null };
    return { status: "ready", job, privateJob: getRequestPrivate(id) };
  } catch {
    return { status: "error", job: null, privateJob: null };
  }
}

export function JobDemo({ id }: { id: string }) {
  const [record] = useState(() => readJob(id));
  const [photos, setPhotos] = useState<Photo[]>([]);
  const { status, job, privateJob } = record;

  useEffect(() => {
    if (!job) return;
    let cancelled = false;
    const urls: string[] = [];
    void (async () => {
      const next: Photo[] = [];
      for (const photoId of job.photo_ids) {
        const blob = await loadPhoto(photoId);
        if (!blob || cancelled) continue;
        const url = URL.createObjectURL(blob);
        urls.push(url);
        next.push({ id: photoId, url });
      }
      if (!cancelled) setPhotos(next);
    })();
    return () => {
      cancelled = true;
      for (const url of urls) URL.revokeObjectURL(url);
    };
  }, [job]);

  if (status === "error") {
    return (
      <main className="mx-auto w-full max-w-xl flex-1 px-4 py-10">
        <h1 className="font-display text-4xl font-semibold text-ink">Job status</h1>
        <p role="alert" className="mt-4 text-lg text-danger">
          This browser couldn&apos;t open saved requests.
        </p>
      </main>
    );
  }
  if (status === "missing" || !job) {
    return (
      <main className="mx-auto w-full max-w-xl flex-1 px-4 py-10">
        <h1 className="font-display text-4xl font-semibold text-ink">Job status</h1>
        <p className="mt-4 text-lg text-muted">This request isn&apos;t on this device.</p>
      </main>
    );
  }

  const pricing = pricingMethods.find((method) => method.id === job.pricing_method);

  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-4 py-6">
      <p className="rounded-2xl bg-brand px-4 py-3 text-base font-semibold text-white">{demoSavedLabel}</p>
      <p className="mt-3 text-sm leading-relaxed text-muted">
        Private details stay in this browser, separate from the public job record. Reloading an unfinished
        request clears phone, email, and street addresses. After you save, this demo keeps them here so you
        can review the job. This is not secure storage.
      </p>
      <h1 className="mt-6 font-display text-4xl font-semibold tracking-tight text-ink">Job status</h1>
      <p className="mt-2 text-lg text-ink">{serviceById(job.service).name}</p>
      <ol className="mt-6 grid gap-2">
        {demoTimeline.map((label, index) => (
          <li
            key={label}
            aria-current={index === 0 ? "step" : undefined}
            className={`flex min-h-12 items-center rounded-2xl px-4 text-base font-semibold ${
              index === 0 ? "bg-brand text-white" : "bg-paper-raised text-muted ring-1 ring-line"
            }`}
          >
            {label}
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
        {job.dropoff_area ? <p>Drop-off area: {job.dropoff_area}</p> : <p>No drop-off address.</p>}
        {job.junk_load_size ? <p>Load size: {labelOf(junkLoadSizes, job.junk_load_size)}</p> : null}
        <p>{pricing?.label}</p>
        {job.pricing_method === "fixed" && job.offer_cents != null ? <p>{formatCents(job.offer_cents)}</p> : null}
        {job.pricing_method === "fixed" ? (
          <p>
            {job.auto_book_on_accept
              ? "Book the first driver who accepts this price."
              : "You will choose before booking."}
          </p>
        ) : null}
        {job.pricing_method === "range" && job.budget_min_cents != null && job.budget_max_cents != null ? (
          <p>
            {formatCents(job.budget_min_cents)}–{formatCents(job.budget_max_cents)}
          </p>
        ) : null}
        <p>{labelOf(hearAboutOptions, job.source)}</p>
        {job.time_window ? <p>{labelOf(timeWindows, job.time_window)}</p> : <p>ASAP</p>}
        {job.needs_value_approval ? <p>{valueApprovalWarning}</p> : null}
      </section>
      {privateJob ? (
        <section className="mt-4 grid gap-2 rounded-3xl bg-paper-raised p-4 ring-1 ring-line">
          <h2 className="text-lg font-semibold text-ink">Private details on this device</h2>
          <p>{privateJob.customer_name}</p>
          <p>{privateJob.customer_phone}</p>
          {privateJob.customer_email ? <p>{privateJob.customer_email}</p> : null}
          <p>Pickup: {privateJob.pickup_address}</p>
          {privateJob.dropoff_address ? <p>Drop-off: {privateJob.dropoff_address}</p> : null}
          {privateJob.access_notes ? <p>{privateJob.access_notes}</p> : null}
        </section>
      ) : (
        <p className="mt-4 text-base text-muted">Contact details are not on this device.</p>
      )}
      {photos.length > 0 ? (
        <ul className="mt-4 grid grid-cols-3 gap-2">
          {photos.map((photo) => (
            <li key={photo.id}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photo.url} alt="" className="aspect-square w-full rounded-2xl object-cover" />
            </li>
          ))}
        </ul>
      ) : null}
    </main>
  );
}

function labelOf(options: readonly { id: string; label: string }[], id: string): string {
  return options.find((option) => option.id === id)?.label ?? id;
}
