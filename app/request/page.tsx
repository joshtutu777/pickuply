import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/placeholder-page";

export const metadata: Metadata = {
  title: "Request a pickup",
};

export default function RequestPage() {
  return (
    <PlaceholderPage
      eyebrow="Customer"
      title="Request a pickup"
      description="Tell us what needs a ride. The request form is not built yet."
    />
  );
}
