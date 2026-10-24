import { Suspense } from "react";
import type { Metadata } from "next";
import { AdminNav } from "@/components/admin/admin-nav";
import { AdminAutoRefresh, AdminDocumentTitle } from "@/components/admin/admin-refresh";
import { LoadingMain } from "@/components/loading-main";
import { adminTabTitle } from "@/lib/admin/ops";
import { loadAdminDashboard } from "@/lib/admin/load";
import { createClient } from "@/lib/supabase/server";

export async function generateMetadata(): Promise<Metadata> {
  const data = await loadAdminDashboard();
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
  const data = await loadAdminDashboard();
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
      <AdminNav badges={badges} />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
