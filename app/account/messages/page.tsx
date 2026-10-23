import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { BackLink } from "@/components/back-link";
import { LoadingMain } from "@/components/loading-main";
import { serviceById, type ServiceId } from "@/lib/constants";
import { requireSignedIn } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Messages",
};

export default function MessagesPage() {
  return (
    <Suspense fallback={<LoadingMain />}>
      <MessagesContent />
    </Suspense>
  );
}

async function MessagesContent() {
  await requireSignedIn("/account/messages");
  const supabase = await createClient();
  const { data: threads, error } = await supabase
    .from("message_threads")
    .select("id, job_id")
    .not("job_id", "is", null);

  const rows: { threadId: string; jobId: string; title: string; area: string }[] = [];
  if (!error) {
    for (const thread of threads ?? []) {
      if (!thread.job_id) continue;
      const { data: open } = await supabase.rpc("job_thread", { target_job: thread.job_id });
      if (open !== thread.id) continue;
      const { data: job } = await supabase
        .from("jobs")
        .select("id, service, pickup_area, description")
        .eq("id", thread.job_id)
        .maybeSingle();
      if (!job) continue;
      const service = serviceById(job.service as ServiceId);
      rows.push({
        threadId: thread.id,
        jobId: job.id,
        title: job.description?.trim() || service.name,
        area: job.pickup_area,
      });
    }
  }

  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-4 py-8">
      <BackLink href="/account" label="Account" />
      <p className="text-sm font-semibold tracking-wide text-brand uppercase">Messages</p>
      <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight text-ink">Messages</h1>
      {error ? (
        <p role="alert" className="mt-6 text-lg text-danger">
          We couldn&apos;t load your messages. Try again.
        </p>
      ) : rows.length === 0 ? (
        <section className="mt-8 rounded-3xl bg-paper-raised p-5 ring-1 ring-line">
          <h2 className="text-xl font-semibold text-ink">No conversations yet</h2>
          <p className="mt-2 text-base leading-relaxed text-muted">
            A chat opens after a driver is assigned. This list only includes conversations that already exist.
          </p>
        </section>
      ) : (
        <ul className="mt-6 grid gap-3">
          {rows.map((row) => (
            <li key={row.threadId}>
              <Link
                href={`/jobs/${row.jobId}#messages`}
                className="block min-h-12 rounded-3xl bg-paper-raised p-4 ring-1 ring-line"
              >
                <p className="text-lg font-semibold text-ink">{row.title}</p>
                <p className="mt-1 text-sm text-muted">{row.area}</p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
