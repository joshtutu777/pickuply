import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { createHelpRequest } from "@/app/help/actions";
import { LoadingMain } from "@/components/loading-main";
import { requireSignedIn } from "@/lib/auth/session";
import { customerTopics, driverTopics, type HelpTopic } from "@/lib/help/topics";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Help" };

const activeStatuses = ["assigned", "en_route", "arrived", "item_check", "in_transit", "delivered"];

export default function HelpPage({ searchParams }: PageProps<"/help">) {
  return (
    <Suspense fallback={<LoadingMain />}>
      <HelpContent searchParams={searchParams} />
    </Suspense>
  );
}

async function HelpContent({ searchParams }: { searchParams: PageProps<"/help">["searchParams"] }) {
  const session = await requireSignedIn("/help");
  const params = await searchParams;
  const error = typeof params.error === "string" ? params.error : "";
  const appeal = params.appeal === "1";
  const query = typeof params.q === "string" ? params.q.trim().toLowerCase() : "";
  const supabase = await createClient();
  const driver = session.role === "driver";
  const topics = filterTopics(driver ? driverTopics : customerTopics, query);
  const { data: jobs } = await supabase
    .from("jobs")
    .select("id, service, status, pickup_area")
    .or(`customer_id.eq.${session.userId},assigned_driver_id.eq.${session.userId}`)
    .order("updated_at", { ascending: false })
    .limit(20);
  const active = (jobs ?? []).find((job) => activeStatuses.includes(job.status));

  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-4 py-8">
      <p className="text-sm font-semibold tracking-wide text-brand uppercase">Help</p>
      <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight text-ink">Help</h1>
      {active && !driver ? (
        <p className="mt-4 rounded-3xl bg-paper-raised p-4 text-base text-ink ring-1 ring-line">
          Problem with your current job?{" "}
          <Link href={`/jobs/${active.id}`} className="font-semibold text-brand">
            Report a problem
          </Link>
        </p>
      ) : null}
      <form className="mt-4" action="/help">
        <label className="block font-semibold text-ink" htmlFor="help-search">
          Search
          <input id="help-search" name="q" defaultValue={query} className="mt-2 min-h-12 w-full rounded-2xl border border-line bg-paper-raised px-4" />
        </label>
      </form>
      <p className="mt-4">
        <Link href="/help/requests" className="inline-flex min-h-12 items-center font-semibold text-brand">
          My requests
        </Link>
      </p>
      {topics.map((topic) => (
        <section key={topic.id} className="mt-6">
          <h2 className="font-display text-2xl font-semibold text-ink">{topic.title}</h2>
          <ul className="mt-3 space-y-3">
            {topic.questions.map((item) => (
              <li key={item.q} className="rounded-3xl bg-paper-raised p-4 ring-1 ring-line">
                <h3 className="font-semibold text-ink">{item.q}</h3>
                <p className="mt-2 text-base text-ink">{item.a}</p>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <section className="mt-8">
        <h2 className="font-display text-2xl font-semibold text-ink">Still need help?</h2>
        {error ? <p role="alert" className="mt-3 text-base text-danger">{error}</p> : null}
        <form action={createHelpRequest} className="mt-4 space-y-3">
          <label className="block font-semibold" htmlFor="topic">
            Topic
            <input
              id="topic"
              name="topic"
              required
              defaultValue={appeal ? "Account restriction" : ""}
              className="mt-2 min-h-12 w-full rounded-2xl border border-line px-4"
            />
          </label>
          <label className="block font-semibold" htmlFor="job">
            Related job
            <select id="job" name="job" className="mt-2 min-h-12 w-full rounded-2xl border border-line bg-paper px-4">
              <option value="">None</option>
              {(jobs ?? []).map((job) => (
                <option key={job.id} value={job.id}>
                  {job.service} · {job.pickup_area}
                </option>
              ))}
            </select>
          </label>
          <label className="block font-semibold" htmlFor="body">
            Message
            <textarea id="body" name="body" required className="mt-2 min-h-28 w-full rounded-2xl border border-line px-4 py-3" />
          </label>
          <p className="text-base text-muted">Add a photo from My requests after the case is created. Photos stay private.</p>
          <button type="submit" className="inline-flex min-h-12 items-center rounded-full bg-brand px-6 font-semibold text-white">
            Send request
          </button>
        </form>
        {driver ? (
          <p className="mt-4">
            <Link href="/support" className="inline-flex min-h-12 items-center font-semibold text-brand">
              Pickuply Support
            </Link>
          </p>
        ) : null}
      </section>
    </main>
  );
}

function filterTopics(topics: HelpTopic[], query: string): HelpTopic[] {
  if (!query) return topics;
  return topics
    .map((topic) => ({
      ...topic,
      questions: topic.questions.filter((item) => `${topic.title} ${item.q} ${item.a}`.toLowerCase().includes(query)),
    }))
    .filter((topic) => topic.questions.length > 0);
}
