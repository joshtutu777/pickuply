import type { Metadata } from "next";
import { Suspense } from "react";
import { AlertCenter } from "@/components/notifications/alert-center";
import { LoadingMain } from "@/components/loading-main";

export const metadata: Metadata = { title: "Alerts" };

export default function DriverNotificationsPage({ searchParams }: PageProps<"/driver/notifications">) {
  return (
    <Suspense fallback={<LoadingMain />}>
      <DriverNotifications searchParams={searchParams} />
    </Suspense>
  );
}

async function DriverNotifications({
  searchParams,
}: {
  searchParams: PageProps<"/driver/notifications">["searchParams"];
}) {
  const query = await searchParams;
  return (
    <AlertCenter path="/driver/notifications" saved={query.saved === "1"} error={query.error === "save"} />
  );
}
