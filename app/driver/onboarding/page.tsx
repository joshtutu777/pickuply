import type { Metadata } from "next";
import { Suspense } from "react";
import { LoadingMain } from "@/components/loading-main";
import { PlaceholderPage } from "@/components/placeholder-page";
import { requireSignedIn } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "Drive with Pickuply",
};

export default function DriverOnboardingPage() {
  return (
    <Suspense fallback={<LoadingMain />}>
      <OnboardingContent />
    </Suspense>
  );
}

async function OnboardingContent() {
  await requireSignedIn("/driver/onboarding");
  return (
    <PlaceholderPage
      eyebrow="Driver"
      title="Drive with Pickuply"
      description="Tell us about your vehicle. Driver signup is not open yet."
    />
  );
}
