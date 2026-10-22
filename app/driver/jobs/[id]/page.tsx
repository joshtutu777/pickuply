import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { advanceJob } from "@/app/driver/jobs/actions";
import { LoadingMain } from "@/components/loading-main";
import { JobTrackerView } from "@/components/request/job-tracker";
import { ProofForm } from "@/components/driver/proof-form";
import { ProofGallery } from "@/components/request/proof-gallery";
import { ReportForm } from "@/components/request/report-form";
import { JobMessages } from "@/components/messages/job-messages";
import { statusLabel } from "@/components/request/job-status";
import { requireSignedIn } from "@/lib/auth/session";
import { buildJobTracker, nextDriverAction } from "@/lib/jobs/tracker";
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
      "id, service, status, created_at, pricing_method, pickup_area, dropoff_area, driver_pay_cents, payment_status, payment_due_at, dump_fee_cents",
    )
    .eq("id", id)
    .maybeSingle();
  if (!job) notFound();
  const [{ data: details }, { data: events }, { data: receipts }] = await Promise.all([
    supabase
      .from("job_private")
      .select("customer_name, pickup_address, dropoff_address, access_notes")
      .eq("job_id", id)
      .maybeSingle(),
    supabase.from("job_events").select("type, created_at, data").eq("job_id", id).order("created_at"),
    supabase.from("job_photos").select("id").eq("job_id", id).eq("stage", "dump_receipt").limit(1),
  ]);
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
      <p className="text-sm font-semibold tracking-wide text-brand uppercase">Assigned job</p>
      <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight text-ink">
        {statusLabel(job.status)}
      </h1>
      <p className="mt-2 text-base text-muted">{job.service}</p>
      {job.driver_pay_cents != null ? <p>Your earnings {formatCents(job.driver_pay_cents)}</p> : null}
      {job.payment_status ? <p>Payment: {job.payment_status.replaceAll("_", " ")}</p> : null}
      {job.status === "assigned" && !["authorized", "paid", "captured"].includes(job.payment_status ?? "") ? (
        <p>Waiting for customer payment</p>
      ) : null}
      {job.status === "assigned" && ["authorized", "paid", "captured"].includes(job.payment_status ?? "") ? (
        <p>Payment confirmed: you can start</p>
      ) : null}
      {job.payment_due_at ? (
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
      <JobTrackerView tracker={tracker} />
      {query.error === "step" ? (
        <p role="alert" className="mt-4 text-base text-danger">
          That step is not available yet.
        </p>
      ) : null}
      {next.waiting ? <p className="mt-4 text-base text-muted">{next.waiting}</p> : null}
      {next.nextStatus ? (
        <form action={advanceJob} className="mt-4">
          <input type="hidden" name="jobId" value={job.id} />
          <input type="hidden" name="nextStatus" value={next.nextStatus} />
          <button
            type="submit"
            className="inline-flex min-h-12 items-center justify-center rounded-full bg-brand px-6 font-semibold text-white"
          >
            {next.label}
          </button>
        </form>
      ) : null}
      <ProofGallery jobId={job.id} />
      <ProofForm jobId={job.id} locationEnabled={Boolean(settings?.proof_location_enabled)} />
      {["assigned", "en_route", "arrived", "item_check", "in_transit", "delivered", "completed", "disputed"].includes(job.status) ? (
        <ReportForm jobId={job.id} />
      ) : null}
      <JobMessages jobId={job.id} showQuickReplies />
      <p className="mt-4">
        <Link href="/support" className="inline-flex min-h-12 items-center font-semibold text-brand">
          Contact support
        </Link>
      </p>
      <Link href="/driver" className="mt-6 inline-flex min-h-12 items-center font-semibold text-brand">
        Driver home
      </Link>
    </main>
  );
}
