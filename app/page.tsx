import type { Metadata } from "next";
import { Suspense } from "react";
import { HomeArticles } from "@/components/blog/home-articles";
import { LandingPage } from "@/components/landing/landing-page";
import { SiteJsonLd } from "@/components/seo/site-json-ld";
import { homeDescription, homeTitle, publicMetadata } from "@/lib/seo";

export const metadata: Metadata = publicMetadata({
  title: homeTitle,
  description: homeDescription,
  path: "/",
  absoluteTitle: true,
});

export default function HomePage() {
  return (
    <>
      <SiteJsonLd />
      <LandingPage
        blog={
          <Suspense fallback={null}>
            <HomeArticles />
          </Suspense>
        }
      />
    </>
  );
}
