import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { LoadingMain } from "@/components/loading-main";
import { cronJobs, cronRunLabel } from "@/lib/cron/jobs";
import { requireAdmin } from "@/lib/auth/session";
import { resolveTestLane } from "@/lib/admin/test-lane-server";
import { issueCountLabel } from "@/lib/observability/issues";
import { loadIssueSummary } from "@/lib/observability/issue-count";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: { absolute: "Health · Pickuply Admin" } };

type CronRow = {
  job_name: string;
  started_at: string;
  finished_at: string;
  ok: boolean;
  error_message: string | null;
};

export default function AdminHealthPage() {
  return (
    <Suspense fallback={<LoadingMain />}>
      <AdminHealth />
    </Suspense>
  );
}

async function AdminHealth() {
  await requireAdmin("/admin/health");
  const lane = await resolveTestLane(false);
  const supabase = await createClient();
  const { data: phoneReady } = await supabase.rpc("admin_phone_protection_ready");
  const runs =
    lane === "test"
      ? { data: [] as CronRow[], error: null }
      : await supabase.from("cron_job_runs").select("job_name, started_at, finished_at, ok, error_message");
  const byName = new Map(((runs.data ?? []) as CronRow[]).map((row) => [row.job_name, row]));
  const issues = lane === "test" ? null : await loadIssueSummary();

  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-4 py-8">
      <p className="text-sm font-semibold tracking-wide text-brand uppercase">Admin</p>
      <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight text-ink">Health</h1>
      <p className="mt-3 text-base text-ink">
        Phone protection: {phoneReady === false ? "not configured" : phoneReady === true ? "configured" : "not checked"}
      </p>
      <p className="mt-4">
        <Link href="/admin" className="font-semibold text-brand">
          Back to the dashboard
        </Link>
      </p>
      <h2 className="mt-8 text-xl font-semibold text-ink">App errors</h2>
      {issues == null ? (
        <p className="mt-3 text-base text-ink">App errors are hidden from a test admin.</p>
      ) : issues.state === "unconfigured" ? (
        <p className="mt-3 text-base text-ink">App errors are not connected yet.</p>
      ) : issues.state === "unavailable" ? (
        <p role="alert" className="mt-3 text-base text-danger">
          The error count could not be loaded.
        </p>
      ) : (
        <p className="mt-3 text-base text-ink">{issueCountLabel(issues.count)}</p>
      )}
      {issues?.href ? (
        <p className="mt-3">
          <a href={issues.href} className="font-semibold text-brand">
            Open the error list
          </a>
        </p>
      ) : null}
      <h2 className="mt-8 text-xl font-semibold text-ink">Scheduled jobs</h2>
      {lane === "test" ? (
        <p className="mt-3 text-base text-ink">Scheduler status is hidden from a test admin.</p>
      ) : runs.error ? (
        <p role="alert" className="mt-3 text-base text-danger">
          Scheduler status is not available yet.
        </p>
      ) : (
        <ul className="mt-3 space-y-3">
          {cronJobs.map((job) => {
            const run = byName.get(job.name);
            const label = cronRunLabel(run ? run.ok : null);
            return (
              <li key={job.name} className="rounded-3xl bg-paper-raised p-4 ring-1 ring-line">
                <p className="text-lg font-semibold text-ink">{job.label}</p>
                <p className="mt-1 text-base text-ink">{job.schedule}</p>
                <p className="mt-1 text-base text-ink">Last result: {label}</p>
                {run ? (
                  <p className="mt-1 text-base text-muted">Finished {new Date(run.finished_at).toLocaleString()}</p>
                ) : (
                  <p className="mt-1 text-base text-muted">No run has been recorded.</p>
                )}
                {run && !run.ok && run.error_message ? (
                  <p role="alert" className="mt-2 text-base text-danger">
                    {run.error_message}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
