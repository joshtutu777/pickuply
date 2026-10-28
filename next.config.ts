import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs/config";
import packageJson from "./package.json";

const commit = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7);
const appRelease = commit ? `${packageJson.version}+${commit}` : packageJson.version;

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_APP_RELEASE: appRelease,
  },
  /* config options here */
  async redirects() {
    return [
      { source: "/signup", destination: "/login", permanent: false },
      {
        source: "/driver/apply",
        destination: "/login?next=/driver/onboarding&intent=driver",
        permanent: false,
      },
    ];
  },
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

const sentryOrg = process.env.SENTRY_ORG;
const sentryProject = process.env.SENTRY_PROJECT;
const sentryToken = process.env.SENTRY_AUTH_TOKEN;

export default sentryOrg && sentryProject && sentryToken
  ? withSentryConfig(nextConfig, {
      org: sentryOrg,
      project: sentryProject,
      authToken: sentryToken,
      silent: true,
      telemetry: false,
      webpack: {
        treeshake: {
          removeDebugLogging: true,
          removeTracing: true,
        },
      },
    })
  : nextConfig;
