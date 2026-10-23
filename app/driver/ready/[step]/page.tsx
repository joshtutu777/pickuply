import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ReadyStep } from "@/components/driver/ready-step";
import { LoadingMain } from "@/components/loading-main";
import { requireSignedIn } from "@/lib/auth/session";

const steps = new Set(["insurance", "vehicle", "equipment", "services", "agreement", "training"]);

const titles: Record<string, string> = {
  insurance: "Insurance",
  vehicle: "Vehicle details",
  equipment: "Equipment and helper",
  services: "Services",
  agreement: "Driver agreement",
  training: "Training",
};

export const metadata: Metadata = {
  title: "Get ready to drive",
};

export default function ReadyStepPage({
  params,
  searchParams,
}: PageProps<"/driver/ready/[step]">) {
  return (
    <Suspense fallback={<LoadingMain />}>
      <ReadyContent params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function ReadyContent({
  params,
  searchParams,
}: {
  params: PageProps<"/driver/ready/[step]">["params"];
  searchParams: PageProps<"/driver/ready/[step]">["searchParams"];
}) {
  const { step } = await params;
  if (!steps.has(step)) notFound();
  const session = await requireSignedIn(`/driver/ready/${step}`);
  const query = await searchParams;
  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-4 py-8">
      <p className="text-sm font-semibold tracking-wide text-brand uppercase">Driver</p>
      <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight text-ink">{titles[step]}</h1>
      <Link href="/driver" className="mt-4 inline-flex min-h-12 items-center font-semibold text-brand">
        Back to the checklist
      </Link>
      <ReadyStep step={step} userId={session.userId} error={typeof query.error === "string" ? query.error : undefined} />
    </main>
  );
}
