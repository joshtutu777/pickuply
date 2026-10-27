import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { assignCoveringDriver, inviteDriver, pauseRequest, refundJob } from "@/app/admin/requests/actions";
import { AccountControls } from "@/components/admin/account-controls";
import { BackLink } from "@/components/back-link";
import { DisputeResolution } from "@/components/admin/dispute-resolution";
import { CopyMessage } from "@/components/admin/copy-message";
import { ReviewRequestForm } from "@/components/admin/review-request-form";
import { LoadingMain } from "@/components/loading-main";
import { AdminOverride } from "@/components/admin/admin-override";
import { DeliveryProof } from "@/components/admin/delivery-proof";
import { AreaMap } from "@/components/maps/area-map";
import { statusLabel } from "@/components/request/job-status";
import { tripLabel } from "@/lib/maps/miles";
import { requireAdmin } from "@/lib/auth/session";
import { noDriverCutoffIso } from "@/lib/admin/ops";
import { serviceById, type ServiceId } from "@/lib/constants";
import { getJobDetail } from "@/lib/data/job-queries";
import { formatCents } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";

async function loadZones(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data } = await supabase.from("zones").select("id, name").eq("active", true).order("name");
  return (data ?? []) as { id: string; name: string }[];
}

export default function AdminRequestPage({
  params,
  searchParams,
}: PageProps<"/admin/requests/[id]">) {
  return (
    <Suspense fallback={<LoadingMain />}>
      <RequestDetail params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function RequestDetail({
  params,
  searchParams,
}: {
  params: PageProps<"/admin/requests/[id]">["params"];
  searchParams: PageProps<"/admin/requests/[id]">["searchParams"];
}) {
  await requireAdmin("/admin/requests");
  const { id } = await params;
  const query = await searchParams;
  const job = await getJobDetail(id);
  if (!job) notFound();
  const supabase = await createClient();
  const { data: extra } = await supabase
    .from("jobs")
    .select("customer_id, assigned_driver_id, item_value_cents, needs_value_approval, description, service, pricing_method, status, detail_request, paused_at")
    .eq("id", id)
    .maybeSingle();
  const headerList = await headers();
  const host = headerList.get("x-forwarded-host") ?? headerList.get("host") ?? "";
  const proto = headerList.get("x-forwarded-proto") ?? "http";
  const link = host ? `${proto}://${host}/jobs/${id}` : `/jobs/${id}`;
  const needsConfirm = Boolean(
    extra?.needs_value_approval ||
      /piano|gun safe|pool table|hot tub|\bsafe\b/i.test(job.description),
  );
  const service = serviceById(job.service as ServiceId);
  const coveringResult =
    job.status === "open"
      ? await supabase.rpc("drivers_covering_pickup", { pickup_area: job.pickup_area, target_job: id })
      : { data: [] as { profile_id: string; summary: string }[] };
  const covering = (coveringResult.data ?? []) as { profile_id: string; summary: string }[];
  const coveringIds = covering.map((row) => row.profile_id);
  const { data: coveringNames } =
    coveringIds.length > 0
      ? await supabase.from("profiles").select("id, full_name").in("id", coveringIds)
      : { data: [] as { id: string; full_name: string | null }[] };
  const coveringName = new Map((coveringNames ?? []).map((row) => [row.id, row.full_name]));
  const { count: waitingWithoutDriver } = await supabase
    .from("jobs")
    .select("id", { count: "exact", head: true })
    .eq("id", id)
    .eq("status", "open")
    .is("assigned_driver_id", null)
    .lte("created_at", noDriverCutoffIso());

  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-4 py-8">
      <p className="text-sm font-semibold tracking-wide text-brand uppercase">Admin</p>
      <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight text-ink">{service.name}</h1>
      <p className="mt-2 text-base text-muted">
        {statusLabel(job.status)} · {job.pricing_method}
      </p>
      {waitingWithoutDriver ? <p className="mt-2 text-base font-semibold text-danger">No driver yet</p> : null}
      <BackLink href="/admin/requests" label="Requests" />
      {query.saved === "1" ? <p className="mt-4 text-base">Saved.</p> : null}
      {typeof query.error === "string" ? (
        <p role="alert" className="mt-4 text-base text-danger">
          {query.error}
        </p>
      ) : null}
      <section className="mt-6 space-y-2 text-base text-ink">
        <p>{job.description}</p>
        <p>
          {job.pieces != null ? `${job.pieces} pieces` : "Pieces not provided"}
          {" · "}
          {job.size ?? "Size not provided"}
          {extra?.item_value_cents != null ? ` · value ${formatCents(extra.item_value_cents)}` : ""}
        </p>
        <p>
          {job.pickup_area}
          {job.dropoff_area ? ` to ${job.dropoff_area}` : ""}
        </p>
        {job.private ? (
          <>
            <p className="break-words">{job.private.customer_name}</p>
            <p className="break-all">{job.private.customer_phone}</p>
            {job.private.customer_email ? <p className="break-all">{job.private.customer_email}</p> : null}
            <p className="break-words">Pickup: {job.private.pickup_address}</p>
            {job.private.pickup_verified === false || job.private.dropoff_verified === false ? (
              <p>Address not verified</p>
            ) : null}
            <p>Trip: {tripLabel(job.distance_miles, job.distance_source)}</p>
            {job.private.pickup_lat != null && job.private.pickup_lng != null ? (
              <AreaMap
                caption={job.private.pickup_verified === false ? "Address not verified" : "Route"}
                pins={[
                  { lat: job.private.pickup_lat, lng: job.private.pickup_lng, label: "Pickup" },
                  ...(job.private.dropoff_lat != null && job.private.dropoff_lng != null
                    ? [{ lat: job.private.dropoff_lat, lng: job.private.dropoff_lng, label: "Drop-off" }]
                    : []),
                ]}
                line={
                  job.private.dropoff_lat != null && job.private.dropoff_lng != null
                    ? [
                        [job.private.pickup_lng, job.private.pickup_lat],
                        [job.private.dropoff_lng, job.private.dropoff_lat],
                      ]
                    : []
                }
              />
            ) : (
              <p>Trip map: —</p>
            )}
            {job.private.dropoff_address ? <p className="break-words">Drop-off: {job.private.dropoff_address}</p> : null}
            {job.private.access_notes ? <p>Access: {job.private.access_notes}</p> : null}
          </>
        ) : null}
      </section>
      {job.photos.length > 0 ? (
        <section className="mt-6" aria-label="Request photos">
          <h2 className="text-lg font-semibold text-ink">Request photos</h2>
          <ul className="mt-3 grid grid-cols-3 gap-2">
            {job.photos.map((photo) => (
              <li key={photo.id}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={photo.url} alt="Request photo" className="aspect-square w-full rounded-2xl object-cover" />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <DeliveryProof
        jobId={id}
        service={job.service}
        receiptRequired={Boolean(job.require_disposal_receipt)}
      />
      {needsConfirm ? (
        <p className="mt-4 text-base font-semibold text-ink">
          This item needs a confirmation before it can be published.
        </p>
      ) : null}
      <CopyMessage
        message={`Your Pickuply request is ready: ${link}`}
      />
      {job.status === "open" ? (
        <section className="mt-6">
          <h2 className="text-lg font-semibold text-ink">Drivers who cover this pickup</h2>
          {covering.length === 0 ? (
            <p className="mt-2 text-base text-muted">No active driver covers this city or ZIP.</p>
          ) : (
            <ul className="mt-3 space-y-3">
              {covering.map((row) => (
                <li key={row.profile_id} className="rounded-3xl bg-paper-raised p-4 ring-1 ring-line">
                  <p className="font-semibold text-ink">{coveringName.get(row.profile_id) || "Driver"}</p>
                  <p className="text-base text-muted">{row.summary}</p>
                  <form action={assignCoveringDriver} className="mt-2">
                    <input type="hidden" name="jobId" value={id} />
                    <input type="hidden" name="driverId" value={row.profile_id} />
                    <button type="submit" className="inline-flex min-h-12 items-center font-semibold text-brand">
                      Assign
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
      {job.status === "open" ? (
        <form action={inviteDriver} className="mt-6 space-y-3">
          <input type="hidden" name="jobId" value={id} />
          <label className="block text-base font-semibold text-ink" htmlFor="driverId">
            Invite a driver by their account id
            <input
              id="driverId"
              name="driverId"
              className="mt-2 min-h-12 w-full rounded-2xl border border-line bg-paper-raised px-4"
            />
          </label>
          <button
            type="submit"
            className="inline-flex min-h-12 items-center justify-center rounded-full bg-brand px-6 font-semibold text-white"
          >
            Invite driver
          </button>
        </form>
      ) : null}
      {job.status === "disputed" ? <DisputeResolution jobId={id} /> : null}
      <AdminOverride jobId={id} />
      <form action={refundJob} className="mt-6 grid gap-2 rounded-3xl bg-paper-raised p-4 ring-1 ring-line">
        <h2 className="text-lg font-semibold text-ink">Refund</h2>
        <p className="text-base text-muted">Before capture, enter the full total to release the hold. After capture, enter the amount to refund.</p>
        <input type="hidden" name="jobId" value={id} />
        <label className="font-semibold" htmlFor="refund-amount">
          Amount in dollars
          <input id="refund-amount" name="amount" inputMode="decimal" required className="mt-1 min-h-12 w-full rounded-2xl border border-line px-3" />
        </label>
        <label className="font-semibold" htmlFor="refund-reason">
          Reason
          <input id="refund-reason" name="reason" required minLength={3} className="mt-1 min-h-12 w-full rounded-2xl border border-line px-3" />
        </label>
        <button type="submit" className="inline-flex min-h-12 items-center font-semibold text-brand">
          Refund
        </button>
      </form>
      {extra?.status === "open" ? (
        <form action={pauseRequest} className="mt-6">
          <input type="hidden" name="jobId" value={id} />
          <input type="hidden" name="paused" value={extra.paused_at ? "no" : "yes"} />
          <button
            type="submit"
            className="inline-flex min-h-12 items-center justify-center rounded-full bg-ink px-6 font-semibold text-white"
          >
            {extra.paused_at ? "Resume for drivers" : "Pause"}
          </button>
          {extra.paused_at ? (
            <p className="mt-3 text-base text-muted">Drivers cannot see this request while it is paused.</p>
          ) : null}
        </form>
      ) : null}
      {extra?.status === "requested" || extra?.status === "in_review" || extra?.status === "open" ? (
        <ReviewRequestForm
          jobId={id}
          pricingMethod={job.pricing_method}
          needsConfirm={needsConfirm}
          askOnly={extra.status === "open" && extra.pricing_method !== "quote"}
          paused={Boolean(extra.paused_at)}
          zones={await loadZones(supabase)}
          detailsOpen={
            extra?.detail_request != null &&
            (extra.detail_request as { answered_at?: string | null }).answered_at == null
          }
        />
      ) : (
        <p className="mt-6 text-base text-muted">This request is not waiting for a first review.</p>
      )}
      {extra?.customer_id ? (
        <>
          <p className="mt-6">
            <Link href={`/admin/customers/${extra.customer_id}`} className="inline-flex min-h-12 items-center font-semibold text-brand">
              Open customer
            </Link>
          </p>
          <AccountControls profileId={extra.customer_id} returnTo={`/admin/requests/${id}`} label="Customer account" />
        </>
      ) : null}
      {extra?.assigned_driver_id ? (
        <AccountControls
          profileId={extra.assigned_driver_id}
          returnTo={`/admin/requests/${id}`}
          label="Driver account"
        />
      ) : null}
    </main>
  );
}
