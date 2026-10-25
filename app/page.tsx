import type { Metadata } from "next";
import { LandingPage } from "@/components/landing/landing-page";

export const metadata: Metadata = {
  title: { absolute: "Pickuply — Say yes to the deal" },
  description: "Arrange local pickups, deliveries, free-item pickups and junk hauling with Pickuply in Georgia.",
};

export default function HomePage() {
  return <LandingPage />;
}
