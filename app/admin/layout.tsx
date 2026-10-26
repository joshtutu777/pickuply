import Link from "next/link";
import { Suspense } from "react";
import type { Metadata } from "next";
import { AdminNav } from "@/components/admin/admin-nav";
import { AdminAutoRefresh, AdminDocumentTitle } from "@/components/admin/admin-refresh";
import { LoadingMain } from "@/components/loading-main";
import { adminTabTitle } from "@/lib/admin/ops";
import { loadAdminDashboard } from "@/lib/admin/load";
import { resolveTestLane } from "@/lib/admin/test-lane-server";
import { createClient } from "@/lib/supabase/server";

export async function generateMetadata(): Promise<Metadata> {
  const lane = await resolveTestLane(false);
  const data = await loadAdminDashboard(lane);
  const count = data.error ? 0 : data.counts.needsAction;
  return { title: { absolute: adminTabTitle(count) } };
}

export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return (
    <Suspense fallback={<LoadingMain />}>
      <AdminFrame>{children}</AdminFrame>
    </Suspense>
  );
}

async function AdminFrame({ children }: { children: React.ReactNode }) {
  const lane = await resolveTestLane(false);
  const data = await loadAdminDashboard(lane);
  const needs = data.error ? [] : data.needs;
  const title = adminTabTitle(needs.length);
  const supabase = await createClient();
  const { data: threads } = await supabase.rpc("admin_open_threads");
  const messageUnread = ((threads ?? []) as { unread?: number }[]).reduce(
    (sum, thread) => sum + Number(thread.unread ?? 0),
    0,
  );
  const { count: alertUnread } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .is("read_at", null);
  const { count: feedbackNew } = await supabase
    .from("beta_feedback")
    .select("id", { count: "exact", head: true })
    .eq("status", "new");
  const [{ data: phoneReady }, { data: adminCount }] = await Promise.all([
    supabase.rpc("admin_phone_protection_ready"),
    supabase.rpc("admin_active_admin_count"),
  ]);
  const badges = {
    overview: needs.length,
    requests: needs.filter((item) => item.kind === "request" || item.kind === "quote").length,
    drivers: needs.filter((item) => item.kind === "driver").length,
    messages: messageUnread,
    alerts: alertUnread ?? 0,
    feedback: feedbackNew ?? 0,
  };

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col md:flex-row">
      <AdminAutoRefresh />
      <AdminDocumentTitle title={title} />
      <AdminNav badges={badges} showTestData={lane !== "test"} />
      <div className="min-w-0 flex-1">
        {phoneReady === false ? (
          <p role="alert" className="bg-danger px-4 py-3 text-base font-semibold text-white">
            Phone protection secret is not configured
          </p>
        ) : null}
        {adminCount === 1 ? (
          <p role="status" className="bg-ink px-4 py-3 text-base text-white">
            Only one active admin. Add a second admin before anyone is removed. The recovery steps are in the deployment notes.
          </p>
        ) : null}
        <section className="px-4 pt-4 text-sm text-muted" aria-label="Health">
          Phone protection: {phoneReady === false ? "not configured" : phoneReady === true ? "configured" : "not checked"}
          {" · "}
          <Link href="/admin/health" className="font-semibold text-brand">
            Scheduler status
          </Link>
        </section>
        {children}
      </div>
    </div>
  );
}
