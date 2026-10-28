import type { BrowserOptions, ErrorEvent } from "@sentry/nextjs";
import { browserName, scrubSentryEvent, type ReportEvent } from "./scrub";

export function sentryOptions(): BrowserOptions {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  const release = process.env.NEXT_PUBLIC_APP_RELEASE;
  return {
    dsn,
    enabled: Boolean(dsn),
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV,
    release,
    tracesSampleRate: 0,
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpBodies: [],
      urlQueryParams: false,
      databaseQueryData: false,
      queues: false,
      stackFrameVariables: false,
      httpHeaders: { request: { allow: ["user-agent"] }, response: false },
    },
    beforeSend(event) {
      const clean = scrubSentryEvent(event as ReportEvent) as ErrorEvent;
      if (!clean.tags?.browser && typeof navigator !== "undefined") {
        const name = browserName(navigator.userAgent);
        if (name) clean.tags = { ...clean.tags, browser: name };
      }
      if (release) clean.tags = { ...clean.tags, app_version: release };
      return clean;
    },
  };
}
