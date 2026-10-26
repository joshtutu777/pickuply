"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { pushTrackingEvent } from "@/components/analytics/analytics-root";
import type { TrackingEvent } from "@/lib/analytics/tracking";

export function TrackedLink({
  href,
  event,
  className,
  children,
}: {
  href: string;
  event: TrackingEvent;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link href={href} className={className} onClick={() => pushTrackingEvent(event, event, {}, false)}>
      {children}
    </Link>
  );
}
