import type { Metadata } from "next";
import { Suspense } from "react";
import { HomeArticles } from "@/components/blog/home-articles";
import { LandingPage } from "@/components/landing/landing-page";

export const metadata: Metadata = {
  title: { absolute: "Pickuply — Say yes to the deal" },
  description: "Arrange local pickups, deliveries, free-item pickups and junk hauling with Pickuply in Georgia.",
};

export default function HomePage() {
  return (
    <LandingPage
      blog={
        <Suspense fallback={null}>
          <HomeArticles />
        </Suspense>
      }
    />
  );
}
