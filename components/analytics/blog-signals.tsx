"use client";

import Link from "next/link";
import { useEffect } from "react";
import { pushTrackingEvent } from "@/components/analytics/analytics-root";

export function BlogArticleSignal({ slug, category }: { slug: string; category: string }) {
  useEffect(() => {
    pushTrackingEvent("blog_article_viewed", `blog_article_viewed:${slug}`, { category });
  }, [category, slug]);

  return (
    <p className="mt-8 flex flex-wrap gap-4">
      <Link
        href="/request"
        className="inline-flex min-h-12 items-center font-semibold text-brand"
        onClick={() => pushTrackingEvent("blog_to_booking_click", `blog_to_booking_click:${slug}`, { category })}
      >
        Request a pickup
      </Link>
      <Link
        href="/driver/apply"
        className="inline-flex min-h-12 items-center font-semibold text-brand"
        onClick={() => pushTrackingEvent("blog_to_driver_signup_click", `blog_to_driver_signup_click:${slug}`, { category })}
      >
        Apply to drive
      </Link>
    </p>
  );
}
