import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/placeholder-page";

export const metadata: Metadata = {
  title: "Your account",
};

export default function AccountPage() {
  return (
    <PlaceholderPage
      eyebrow="Customer"
      title="Your account"
      description="Your pickups will show up here. The customer dashboard is not built yet."
    />
  );
}
