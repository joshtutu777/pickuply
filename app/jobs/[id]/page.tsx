import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { OfferChoices, type OfferSummary } from "@/components/request/offer-choices";
import { PayPanel } from "@/components/request/pay-panel";
import { JobMissing, JobStatus } from "@/components/request/job-status";
import { JobMessages } from "@/components/messages/job-messages";
import { ProofGallery } from "@/components/request/proof-gallery";
import { ReportForm } from "@/components/request/report-form";
import { getOptionalSession } from "@/lib/auth/session";
import { getAssignedDriverCard } from "@/lib/data/driver-card";
import { getJobDetail } from "@/lib/data/job-queries";
import { getQuoteNotice } from "@/lib/data/quote";
import { buildJobTracker } from "@/lib/jobs/tracker";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Request",
};

export default function JobPage({ params, searchParams }: PageProps<"/jobs/[id]">) {
  return (
    <Suspense
      fallback={
        <main className="mx-auto w-full max-w-xl flex-1 px-4 py-10 text-lg text-muted">
          Loading this request.
        </main>
      }
    >
      <JobEntry params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function JobEntry({
  params,
  searchParams,
}: {
  params: PageProps<"/jobs/[id]">["params"];
  searchParams: PageProps<"/jobs/[id]">["searchParams"];
}) {
  await connection();
  const { id } = await params;
  const query = await searchParams;
  const job = await getJobDetail(id);
  if (!job) return <JobMissing />;
  const [session, notice, driver] = await Promise.all([
    getOptionalSession(),
    getQuoteNotice(id),
    job.assigned_driver_id ? getAssignedDriverCard(id) : Promise.resolve(null),
  ]);
  let offers: OfferSummary[] = [];
  if (session?.role === "customer") {
    try {
      const supabase = await createClient();
      const { data } = await supabase.rpc("offer_summaries", { target_job: id });
      offers = (data ?? []) as OfferSummary[];
    } catch {
      offers = [];
    }
  }
  return (
    <>
      <JobStatus
        job={job}
        notice={notice}
        canRespond={session?.role === "customer"}
        error={typeof query.error === "string" ? query.error : undefined}
        tracker={buildJobTracker({
          service: job.service,
          status: job.status,
          pricingMethod: job.pricing_method,
          paymentStatus: job.payment_status,
          createdAt: job.created_at,
          dumpFeeCents: job.dump_fee_cents,
          hasDumpReceipt: job.has_dump_receipt,
          events: job.events.map((event) => ({
            type: event.type,
            createdAt: event.created_at,
            toStatus: event.to_status,
          })),
        })}
        driver={driver}
      />
      <div className="mx-auto w-full max-w-xl px-4">
        <JobMessages jobId={id} />
        <ProofGallery jobId={id} />
        {["assigned", "en_route", "arrived", "item_check", "in_transit", "delivered", "completed", "disputed"].includes(job.status) ? (
          <ReportForm jobId={id} />
        ) : null}
        <p className="mt-4">
          <Link href="/support" className="inline-flex min-h-12 items-center font-semibold text-brand">
            Contact support
          </Link>
        </p>
      </div>
      {session?.role === "customer" ? <OfferChoices jobId={id} offers={offers} /> : null}
      {session?.role === "customer" &&
      job.status === "assigned" &&
      job.price_cents != null &&
      job.driver_pay_cents != null &&
      job.platform_fee_cents != null &&
      job.service_fee_cents != null ? (
        <PayPanel
          jobId={id}
          driverPayCents={job.driver_pay_cents}
          platformFeeCents={job.platform_fee_cents}
          serviceFeeCents={job.service_fee_cents}
          totalCents={job.price_cents}
          paymentStatus={job.payment_status}
          minutesLeft={
            job.payment_due_at
              ? Math.max(0, Math.ceil((new Date(job.payment_due_at).getTime() - new Date().getTime()) / 60000))
              : 0
          }
          windowOpen={job.payment_due_at != null && new Date(job.payment_due_at).getTime() > new Date().getTime()}
          returning={query.paid === "return"}
        />
      ) : null}
    </>
  );
}
