import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["sharp"],
  experimental: {
    proxyClientMaxBodySize: "8mb",
  },
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

export default nextConfig;
