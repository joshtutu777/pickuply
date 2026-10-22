import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { LoadingMain } from "@/components/loading-main";
import { statusLabel } from "@/components/request/job-status";
import { requireSignedIn } from "@/lib/auth/session";
import { formatCents } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Assigned job",
};

export default function DriverJobPage({ params }: PageProps<"/driver/jobs/[id]">) {
  return (
    <Suspense fallback={<LoadingMain />}>
      <DriverJob params={params} />
    </Suspense>
  );
}

async function DriverJob({ params }: { params: PageProps<"/driver/jobs/[id]">["params"] }) {
  const session = await requireSignedIn("/driver/jobs");
  if (session.role !== "driver") notFound();
  const { id } = await params;
  const supabase = await createClient();
  const { data: job } = await supabase
    .from("jobs")
    .select(
      "id, service, status, pickup_area, dropoff_area, driver_pay_cents, payment_status, payment_due_at",
    )
    .eq("id", id)
    .maybeSingle();
  if (!job) notFound();
  const { data: details } = await supabase
    .from("job_private")
    .select("customer_name, pickup_address, dropoff_address, access_notes")
    .eq("job_id", id)
    .maybeSingle();

  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-4 py-8">
      <p className="text-sm font-semibold tracking-wide text-brand uppercase">Assigned job</p>
      <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight text-ink">
        {statusLabel(job.status)}
      </h1>
      <p className="mt-2 text-base text-muted">{job.service}</p>
      {job.driver_pay_cents != null ? <p>Your earnings {formatCents(job.driver_pay_cents)}</p> : null}
      {job.payment_status ? <p>Payment: {job.payment_status.replaceAll("_", " ")}</p> : null}
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
      <Link href="/driver" className="mt-6 inline-flex min-h-12 items-center font-semibold text-brand">
        Driver home
      </Link>
    </main>
  );
}
