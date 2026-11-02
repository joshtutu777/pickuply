import type { Metadata } from "next";

/** Production origin. Public canonical links use this host. */
export const siteUrl = "https://pickuplyapp.com";

export const homeTitle = "Pickuply | Local Pickup & Delivery in Atlanta, GA";

export const homeDescription =
  "Need furniture, appliances, or Facebook Marketplace purchases picked up? Pickuply connects you with local drivers with trucks and vans across Metro Atlanta.";

/** Pages a signed-out visitor can read. Private app screens stay out of the sitemap. */
export const publicIndexPaths = [
  "/",
  "/request",
  "/drive",
  "/contact",
  "/blog",
  "/terms",
  "/privacy",
  "/terms/driver",
] as const;

export const privatePathPrefixes = [
  "/login",
  "/account",
  "/driver",
  "/admin",
  "/jobs",
  "/help",
  "/auth",
  "/feedback",
  "/support",
  "/api",
  "/offline",
  "/app",
] as const;

export function publicMetadata(input: {
  title: string;
  description: string;
  path: string;
  absoluteTitle?: boolean;
}): Metadata {
  return {
    title: input.absoluteTitle ? { absolute: input.title } : input.title,
    description: input.description,
    alternates: { canonical: input.path },
    openGraph: {
      title: input.title,
      description: input.description,
      url: input.path,
      siteName: "Pickuply",
      type: "website",
    },
  };
}

export const noIndex: Metadata = {
  robots: { index: false, follow: false },
};

/** Organization and WebSite facts already published on the site. */
export function siteStructuredData() {
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": `${siteUrl}/#organization`,
        name: "Pickuply",
        url: siteUrl,
        logo: `${siteUrl}/icons/icon-512.png`,
        email: "info@pickuplyapp.com",
        address: {
          "@type": "PostalAddress",
          streetAddress: "1985 Chattahoochee Dr",
          addressLocality: "Duluth",
          addressRegion: "GA",
          postalCode: "30097",
          addressCountry: "US",
        },
        areaServed: {
          "@type": "AdministrativeArea",
          name: "Metro Atlanta",
        },
      },
      {
        "@type": "WebSite",
        "@id": `${siteUrl}/#website`,
        name: "Pickuply",
        url: siteUrl,
        description: homeDescription,
        publisher: { "@id": `${siteUrl}/#organization` },
      },
    ],
  };
}
