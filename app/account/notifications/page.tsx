import type { Metadata } from "next";
import { Suspense } from "react";
import { AlertCenter } from "@/components/notifications/alert-center";
import { LoadingMain } from "@/components/loading-main";

export const metadata: Metadata = { title: "Alerts" };

export default function AccountNotificationsPage({ searchParams }: PageProps<"/account/notifications">) {
  return (
    <Suspense fallback={<LoadingMain />}>
      <AccountNotifications searchParams={searchParams} />
    </Suspense>
  );
}

async function AccountNotifications({
  searchParams,
}: {
  searchParams: PageProps<"/account/notifications">["searchParams"];
}) {
  const query = await searchParams;
  return (
    <AlertCenter path="/account/notifications" saved={query.saved === "1"} error={query.error === "save"} backHref="/account" backLabel="Account" />
  );
}
