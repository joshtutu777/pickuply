import type { Metadata } from "next";
import { Suspense } from "react";
import { AlertCenter } from "@/components/notifications/alert-center";
import { LoadingMain } from "@/components/loading-main";
import { requireAdmin } from "@/lib/auth/session";

export const metadata: Metadata = { title: { absolute: "Alerts · Pickuply Admin" } };

export default function AdminNotificationsPage({ searchParams }: PageProps<"/admin/notifications">) {
  return (
    <Suspense fallback={<LoadingMain />}>
      <AdminNotifications searchParams={searchParams} />
    </Suspense>
  );
}

async function AdminNotifications({
  searchParams,
}: {
  searchParams: PageProps<"/admin/notifications">["searchParams"];
}) {
  await requireAdmin("/admin/notifications");
  const query = await searchParams;
  return (
    <AlertCenter path="/admin/notifications" saved={query.saved === "1"} error={query.error === "save"} backHref="/admin" backLabel="Admin" showContact />
  );
}
