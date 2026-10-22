import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/placeholder-page";

export const metadata: Metadata = {
  title: "Driver home",
};

export default function DriverPage() {
  return (
    <PlaceholderPage
      eyebrow="Driver"
      title="Driver home"
      description="Assigned jobs will show up here. The driver home is not built yet."
    />
  );
}
