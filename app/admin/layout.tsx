import { Suspense } from "react";
import type { Metadata } from "next";
import { AdminNav } from "@/components/admin/admin-nav";
import { AdminAutoRefresh, AdminDocumentTitle } from "@/components/admin/admin-refresh";
import { LoadingMain } from "@/components/loading-main";
import { adminTabTitle } from "@/lib/admin/ops";
import { loadAdminDashboard } from "@/lib/admin/load";

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
  const badges = {
    overview: needs.length,
    requests: needs.filter((item) => item.kind === "request" || item.kind === "quote").length,
    jobs: needs.filter((item) => item.kind === "open" || item.kind === "payment").length,
    drivers: needs.filter((item) => item.kind === "driver").length,
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
