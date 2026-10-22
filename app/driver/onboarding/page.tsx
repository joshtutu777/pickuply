import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/placeholder-page";

export const metadata: Metadata = {
  title: "Drive with Pickuply",
};

export default function DriverOnboardingPage() {
  return (
    <PlaceholderPage
      eyebrow="Driver"
      title="Drive with Pickuply"
      description="Tell us about your vehicle. Driver signup is not open yet."
    />
  );
}
