import type { Metadata } from "next";
import { Suspense } from "react";
import { LoadingMain } from "@/components/loading-main";
import { requireSignedIn } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "Driver training",
};

const steps = [
  "Read the job card. It shows the area, size, and your pay. The street address appears only after you are assigned.",
  "Photograph the item at pickup and again at drop-off. Junk jobs also need a dump receipt.",
  "At the item check, confirm the item matches the request. If it does not, stop and tell the customer in the app.",
  "Use blankets and straps. Do not haul prohibited items, and do not dump junk on a roadside.",
  "If the seller does not show up, wait the agreed time, then mark the problem in the app. Do not call the customer outside the app.",
];

export default function DriverTrainingPage() {
  return (
    <Suspense fallback={<LoadingMain />}>
      <TrainingContent />
    </Suspense>
  );
}

async function TrainingContent() {
  await requireSignedIn("/driver/training");
  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-4 py-8">
      <p className="text-sm font-semibold tracking-wide text-brand uppercase">Driver</p>
      <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight text-ink">Quick training</h1>
      <ol className="mt-6 list-decimal space-y-4 pl-5 text-base leading-relaxed text-ink">
        {steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
    </main>
  );
}
