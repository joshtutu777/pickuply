import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/placeholder-page";

export const metadata: Metadata = {
  title: "Driver Terms",
};

export default function DriverTermsPage() {
  return (
    <PlaceholderPage
      eyebrow="Draft — pending legal review"
      title="Driver Terms"
      description="Version driver-terms-v1. These terms are a development placeholder and are not a finished legal agreement. A driver accepts them by checking the box on Quick Apply. Pickuply does not check that box for anyone."
    />
  );
}
