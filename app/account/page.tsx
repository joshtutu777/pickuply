import type { Metadata } from "next";
import { Suspense } from "react";
import { LoadingMain } from "@/components/loading-main";
import { PlaceholderPage } from "@/components/placeholder-page";
import { singleQuery } from "@/lib/auth/query";
import { requireSignedIn } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "Your account",
};

export default function AccountPage({
  searchParams,
}: PageProps<"/account">) {
  return (
    <Suspense fallback={<LoadingMain />}>
      <AccountContent searchParams={searchParams} />
    </Suspense>
  );
}

async function AccountContent({
  searchParams,
}: {
  searchParams: PageProps<"/account">["searchParams"];
}) {
  await requireSignedIn("/account");
  const params = await searchParams;
  return (
    <PlaceholderPage
      eyebrow="Customer"
      title="Your account"
      description="Your pickups will show up here. The customer dashboard is not built yet."
      forbidden={singleQuery(params.error) === "forbidden"}
    />
  );
}
