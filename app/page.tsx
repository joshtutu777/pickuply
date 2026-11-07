import type { Metadata } from "next";
import { Suspense } from "react";
import { HomeArticles } from "@/components/blog/home-articles";
import { LandingAccount, LandingAccountFallback } from "@/components/landing/landing-account";
import { LandingPage } from "@/components/landing/landing-page";

export const metadata: Metadata = {
  title: { absolute: "Pickuply — Say yes to the deal" },
  description: "Arrange local pickups, deliveries, free-item pickups and junk hauling with Pickuply in Georgia.",
};

export default function HomePage() {
  return (
    <LandingPage
      account={
        <Suspense fallback={<LandingAccountFallback />}>
          <LandingAccount />
        </Suspense>
      }
      blog={
        <Suspense fallback={null}>
          <HomeArticles />
        </Suspense>
      }
    />
  );
}
