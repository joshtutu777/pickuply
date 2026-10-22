import type { Metadata } from "next";
import { Suspense } from "react";
import { OfferChoices, type OfferSummary } from "@/components/request/offer-choices";
import { JobMissing, JobStatus } from "@/components/request/job-status";
import { getOptionalSession } from "@/lib/auth/session";
import { getJobDetail } from "@/lib/data/job-queries";
import { getQuoteNotice } from "@/lib/data/quote";
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
  const { id } = await params;
  const query = await searchParams;
  const job = await getJobDetail(id);
  if (!job) return <JobMissing />;
  const [session, notice] = await Promise.all([getOptionalSession(), getQuoteNotice(id)]);
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
      />
      {session?.role === "customer" ? <OfferChoices jobId={id} offers={offers} /> : null}
    </>
  );
}
