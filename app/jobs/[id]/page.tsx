import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { BackLink } from "@/components/back-link";
import { OfferChoices, type OfferSummary } from "@/components/request/offer-choices";
import { PayPanel } from "@/components/request/pay-panel";
import { DropoffReview, ItemDecision } from "@/components/request/item-decision";
import { JobStatusWatch } from "@/components/request/job-status-watch";
import { JobReceipt } from "@/components/request/job-receipt";
import { JobMissing, JobStatus } from "@/components/request/job-status";
import { JobMessages } from "@/components/messages/job-messages";
import { DetailReply } from "@/components/request/detail-reply";
import { PickupProof, ProofGallery } from "@/components/request/proof-gallery";
import { ReviewPanel } from "@/components/reviews/review-panel";
import { ReportForm } from "@/components/request/report-form";
import { JobSignals } from "@/components/analytics/job-signals";
import { ScrollOnValue } from "@/components/scroll-restore";
import { getOptionalSession } from "@/lib/auth/session";
import { getAssignedDriverCard } from "@/lib/data/driver-card";
import { getJobDetail } from "@/lib/data/job-queries";
import { measureTrip } from "@/lib/maps/route";
import { getQuoteNotice } from "@/lib/data/quote";
import { formatUsDay } from "@/lib/time/when";
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
  let detailRequest: { items: string[]; note: string } | null = null;
  let livePayment = false;
  let testJob = false;
  if (session) {
    try {
      const supabase = await createClient();
      const testRow = await supabase.from("jobs").select("is_test").eq("id", id).maybeSingle();
      testJob = testRow.data?.is_test === true;
      if (session.role === "customer") {
        const payment = await supabase.from("job_payments").select("stripe_livemode").eq("job_id", id).maybeSingle();
        livePayment = payment.data?.stripe_livemode === true;
      }
      if (session.role !== "customer") {
        offers = [];
      } else {
      const { data } = await supabase.rpc("offer_summaries", { target_job: id });
      offers = (data ?? []) as OfferSummary[];
      const details = await supabase.rpc("open_detail_request", { target_job: id });
      if (details.data && typeof details.data === "object") {
        const body = details.data as { items?: unknown; note?: unknown };
        detailRequest = {
          items: Array.isArray(body.items) ? body.items.filter((item): item is string => typeof item === "string") : [],
          note: typeof body.note === "string" ? body.note : "",
        };
      }
      }
    } catch {
      offers = [];
    }
  }
  const pickup =
    job.private?.pickup_lat != null && job.private.pickup_lng != null
      ? { lat: job.private.pickup_lat, lng: job.private.pickup_lng }
      : null;
  const dropoff =
    job.private?.dropoff_lat != null && job.private.dropoff_lng != null
      ? { lat: job.private.dropoff_lat, lng: job.private.dropoff_lng }
      : null;
  const route = await measureTrip(pickup, dropoff);
  const payReady =
    session?.role === "customer" &&
    job.status === "assigned" &&
    job.price_cents != null &&
    job.driver_pay_cents != null &&
    job.platform_fee_cents != null &&
    job.service_fee_cents != null;
  return (
    <>
      <ScrollOnValue value={`${job.status}:${job.payment_status ?? ""}`} />
      {session?.role === "customer" ? <JobStatusWatch jobId={id} status={job.status} /> : null}
      <div className="mx-auto w-full max-w-xl px-4 pt-4">
        <BackLink href="/account/jobs" label="Jobs" />
      </div>
      <JobStatus
        job={job}
        routeLine={route.line}
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
          requireDisposalReceipt: job.require_disposal_receipt,
          hasDumpReceipt: job.has_dump_receipt,
          events: job.events.map((event) => ({
            type: event.type,
            createdAt: event.created_at,
            toStatus: event.to_status,
          })),
        })}
        driver={driver}
        offers={
          session?.role === "customer" &&
          ["assigned", "en_route", "arrived", "item_check", "in_transit", "delivered", "completed", "disputed"].includes(job.status) ? (
            <p className="text-base text-ink">
              {driver ? `${driver.firstName} is booked.` : "A driver is booked."} New offers are closed.
            </p>
          ) : session?.role === "customer" ? (
            <OfferChoices jobId={id} offers={offers} />
          ) : (
            <p className="text-base text-muted">No offers to review.</p>
          )
        }
        support={
          <>
            <div id="messages">
              <JobMessages jobId={id} />
            </div>
            {job.status !== "item_check" && job.status !== "delivered" ? <ProofGallery jobId={id} /> : null}
            <p className="mt-2">
              <Link href="/help" className="inline-flex min-h-12 items-center font-semibold text-brand">
                Help
              </Link>
            </p>
          </>
        }
        footer={
          <>
            {session && job.status === "completed" ? (
              <ReviewPanel
                jobId={id}
                userId={session.userId}
                nextPath={`/jobs/${id}`}
                skipHref="/account"
                canModerate={session.role === "admin"}
              />
            ) : null}
            {session?.role === "customer" && job.price_cents != null && job.status !== "requested" ? (
              <JobReceipt
                jobId={id}
                service={job.service}
                when={formatUsDay(job.updated_at.slice(0, 10))}
                driverFirstName={driver?.firstName ?? null}
                driverSubtotalCents={
                  job.driver_pay_cents == null ? null : job.driver_pay_cents + (job.platform_fee_cents ?? 0)
                }
                serviceFeeCents={job.service_fee_cents}
                totalCents={job.price_cents}
                tripFeeCents={job.trip_fee_cents}
                refundedCents={job.refunded_cents ?? 0}
                paymentStatus={job.payment_status}
                canCancel={job.status === "assigned"}
              />
            ) : null}
          </>
        }
        review={
          session?.role === "customer" && job.status === "delivered" ? (
            <DropoffReview jobId={id} confirmed={job.customer_confirmed_at != null} />
          ) : session?.role === "customer" && job.status === "item_check" ? (
            <>
              <PickupProof jobId={id} />
              <ItemDecision jobId={id} reviewUntil={job.pickup_review_until} embedded />
              <ReportForm jobId={id} />
            </>
          ) : null
        }
      >
        {payReady ? (
          <PayPanel
            jobId={id}
            driverPayCents={job.driver_pay_cents!}
            platformFeeCents={job.platform_fee_cents!}
            serviceFeeCents={job.service_fee_cents!}
            totalCents={job.price_cents!}
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
      </JobStatus>
      <JobSignals
        jobId={id}
        status={job.status}
        paymentStatus={job.payment_status}
        capturedCents={job.captured_cents}
        live={livePayment}
        isTest={testJob}
        returning={query.paid === "return"}
        tracked={typeof query.tracked === "string" ? query.tracked : null}
        offerIds={offers.map((offer) => offer.offer_id)}
      />
      {query.saved === "1" ? (
        <p className="mx-auto mt-3 w-full max-w-xl px-4 text-base text-ink">Your answers were sent.</p>
      ) : null}
      {detailRequest && detailRequest.items.length > 0 ? (
        <DetailReply jobId={id} items={detailRequest.items} note={detailRequest.note} />
      ) : null}
    </>
  );
}
