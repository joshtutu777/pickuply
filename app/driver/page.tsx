import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ForbiddenAlert } from "@/components/forbidden-alert";
import { LoadingMain } from "@/components/loading-main";
import { PlaceholderPage } from "@/components/placeholder-page";
import { singleQuery } from "@/lib/auth/query";
import { requireSignedIn } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "Driver home",
};

export default function DriverPage({ searchParams }: PageProps<"/driver">) {
  return (
    <Suspense fallback={<LoadingMain />}>
      <DriverContent searchParams={searchParams} />
    </Suspense>
  );
}

async function DriverContent({
  searchParams,
}: {
  searchParams: PageProps<"/driver">["searchParams"];
}) {
  const session = await requireSignedIn("/driver");
  const params = await searchParams;
  const forbidden = singleQuery(params.error) === "forbidden";

  if (session.role === "driver") {
    return (
      <PlaceholderPage
        eyebrow="Driver"
        title="Driver home"
        description="Assigned jobs will show up here. The driver home is not built yet."
        forbidden={forbidden}
      />
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center px-5 py-14">
      <p className="text-sm font-semibold tracking-wide text-brand uppercase">Driver</p>
      <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight text-ink">
        Become a driver
      </h1>
      <p className="mt-4 text-lg leading-relaxed text-muted">
        Have a truck or van? You can haul items for people nearby. Submit an application and we
        will review your documents.
      </p>
      {forbidden ? <ForbiddenAlert /> : null}
      <Link
        href="/driver/onboarding"
        className="mt-8 inline-flex min-h-12 items-center justify-center self-start rounded-full bg-brand px-6 text-base font-semibold text-white transition-colors hover:bg-brand-dark"
      >
        Start driver signup
      </Link>
    </main>
  );
}
