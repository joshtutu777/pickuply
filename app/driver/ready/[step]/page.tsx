import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { BackLink } from "@/components/back-link";
import { ReadyStep, type ReadyExisting } from "@/components/driver/ready-step";
import { LoadingMain } from "@/components/loading-main";
import { requireSignedIn } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

const steps = new Set(["license", "insurance", "vehicle", "equipment", "services", "agreement", "training"]);

const titles: Record<string, string> = {
  license: "License",
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
  const supabase = await createClient();
  const [{ data: driver }, { data: vehicle }] = await Promise.all([
    supabase
      .from("drivers")
      .select(
        "license_url, license_expires, insurance_url, insurance_expires, equipment, helper_name, services, service_level",
      )
      .eq("profile_id", session.userId)
      .maybeSingle(),
    supabase
      .from("vehicles")
      .select("type, make, model, year, plate, cargo_length_in, photo_url")
      .eq("driver_id", session.userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  const existing: ReadyExisting = {
    licenseUrl: driver?.license_url ?? null,
    licenseExpires: driver?.license_expires ?? null,
    insuranceUrl: driver?.insurance_url ?? null,
    insuranceExpires: driver?.insurance_expires ?? null,
    vehicleType: vehicle?.type ?? null,
    make: vehicle?.make ?? null,
    model: vehicle?.model ?? null,
    year: vehicle?.year ?? null,
    plate: vehicle?.plate ?? null,
    cargo: vehicle?.cargo_length_in ?? null,
    vehiclePhoto: vehicle?.photo_url ?? null,
    equipment: driver?.equipment ?? [],
    helperName: driver?.helper_name ?? null,
    services: driver?.services ?? [],
    serviceLevel: driver?.service_level ?? null,
    fullName: session.fullName,
  };
  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-4 py-8 pb-24">
      <BackLink href="/driver" label="Get Ready to Drive" />
      <p className="text-sm font-semibold tracking-wide text-brand uppercase">Driver</p>
      <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight text-ink">{titles[step]}</h1>
      <ReadyStep
        step={step}
        userId={session.userId}
        existing={existing}
        error={typeof query.error === "string" ? query.error : undefined}
      />
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-paper px-4 py-2" aria-label="Back">
        <BackLink href="/driver" label="Get Ready to Drive" />
      </nav>
    </main>
  );
}
