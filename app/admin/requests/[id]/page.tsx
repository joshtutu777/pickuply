import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { inviteDriver } from "@/app/admin/requests/actions";
import { DisputeResolution } from "@/components/admin/dispute-resolution";
import { CopyMessage } from "@/components/admin/copy-message";
import { ReviewRequestForm } from "@/components/admin/review-request-form";
import { LoadingMain } from "@/components/loading-main";
import { statusLabel } from "@/components/request/job-status";
import { requireAdmin } from "@/lib/auth/session";
import { serviceById, type ServiceId } from "@/lib/constants";
import { getJobDetail } from "@/lib/data/job-queries";
import { formatCents } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";

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
  const [{ data: extra }, { data: zones }] = await Promise.all([
    supabase
      .from("jobs")
      .select("item_value_cents, needs_value_approval, description, service, pricing_method, status")
      .eq("id", id)
      .maybeSingle(),
    supabase.from("zones").select("id, name").eq("active", true).order("name"),
  ]);
  const headerList = await headers();
  const host = headerList.get("x-forwarded-host") ?? headerList.get("host") ?? "";
  const proto = headerList.get("x-forwarded-proto") ?? "http";
  const link = host ? `${proto}://${host}/jobs/${id}` : `/jobs/${id}`;
  const needsConfirm = Boolean(
    extra?.needs_value_approval ||
      /piano|gun safe|pool table|hot tub|\bsafe\b/i.test(job.description),
  );
  const service = serviceById(job.service as ServiceId);

  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-4 py-8">
      <p className="text-sm font-semibold tracking-wide text-brand uppercase">Admin</p>
      <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight text-ink">{service.name}</h1>
      <p className="mt-2 text-base text-muted">
        {statusLabel(job.status)} · {job.pricing_method}
      </p>
      <Link href="/admin/requests" className="mt-4 inline-flex min-h-12 items-center font-semibold text-brand">
        All requests
      </Link>
      {query.saved === "1" ? <p className="mt-4 text-base">Saved.</p> : null}
      {typeof query.error === "string" ? (
        <p role="alert" className="mt-4 text-base text-danger">
          {query.error}
        </p>
      ) : null}
      <section className="mt-6 space-y-2 text-base text-ink">
        <p>{job.description}</p>
        <p>
          {job.pieces} pieces · {job.size}
          {extra?.item_value_cents != null ? ` · value ${formatCents(extra.item_value_cents)}` : ""}
        </p>
        <p>
          {job.pickup_area}
          {job.dropoff_area ? ` to ${job.dropoff_area}` : ""}
        </p>
        {job.private ? (
          <>
            <p>{job.private.customer_name}</p>
            <p>{job.private.customer_phone}</p>
            {job.private.customer_email ? <p>{job.private.customer_email}</p> : null}
            <p>Pickup: {job.private.pickup_address}</p>
            {job.private.dropoff_address ? <p>Drop-off: {job.private.dropoff_address}</p> : null}
            {job.private.access_notes ? <p>Access: {job.private.access_notes}</p> : null}
          </>
        ) : null}
      </section>
      {job.photos.length > 0 ? (
        <ul className="mt-4 grid grid-cols-3 gap-2">
          {job.photos.map((photo) => (
            <li key={photo.id}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photo.url} alt="" className="aspect-square w-full rounded-2xl object-cover" />
            </li>
          ))}
        </ul>
      ) : null}
      {needsConfirm ? (
        <p className="mt-4 text-base font-semibold text-ink">
          This item needs a confirmation before it can be published.
        </p>
      ) : null}
      <CopyMessage
        message={`Your Pickuply request is ready: ${link}`}
      />
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
      {job.status === "requested" || job.status === "in_review" ? (
        <ReviewRequestForm
          jobId={id}
          zones={zones ?? []}
          pricingMethod={job.pricing_method}
          needsConfirm={needsConfirm}
        />
      ) : (
        <p className="mt-6 text-base text-muted">This request is not waiting for a first review.</p>
      )}
    </main>
  );
}
