import "server-only";

import { cronErrorText } from "@/lib/cron/errors";
import type { CronJobName } from "@/lib/cron/jobs";
import { createServiceClient } from "@/lib/supabase/service";
import { NextResponse } from "next/server";

/** Records the latest run. A missing table must not change the job's response. */
export async function recordCronRun(input: {
  job: CronJobName;
  startedAt: string;
  ok: boolean;
  error: string | null;
}): Promise<void> {
  try {
    const supabase = createServiceClient();
    const { error } = await supabase.rpc("record_cron_run", {
      target_job: input.job,
      started_at: input.startedAt,
      finished_at: new Date().toISOString(),
      succeeded: input.ok,
      error_message: input.ok ? null : input.error,
    });
    if (error) return;
  } catch {
    // The scheduled work already finished. Monitoring is recorded on the next run.
  }
}

export async function runCron(
  job: CronJobName,
  work: () => Promise<Record<string, unknown>>,
): Promise<NextResponse> {
  const startedAt = new Date().toISOString();
  try {
    const body = await work();
    await recordCronRun({ job, startedAt, ok: true, error: null });
    return NextResponse.json(body);
  } catch (error) {
    const message = cronErrorText(error, process.env.CRON_SECRET);
    await recordCronRun({ job, startedAt, ok: false, error: message });
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
