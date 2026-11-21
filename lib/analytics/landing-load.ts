import { classifySource, touchFromLocation, type AttributionSource } from "@/lib/analytics/attribution";

/** Public pages a landing count may name. Job, account, and admin addresses are excluded. */
export const landingLoadPaths = [
  "/",
  "/request",
  "/blog",
  "/contact",
  "/help",
  "/privacy",
  "/terms",
  "/terms/driver",
  "/support",
] as const;

export const landingCampaignCap = 100;
export const landingLoadOverflow = "other";
export const landingLoadNone = "none";
export const landingLoadRatePerMinute = 600;

const exactPaths = new Set<string>(landingLoadPaths);

export type LandingLoadRecord = {
  path: string;
  source: AttributionSource;
  campaign: string;
};

export function landingLoadPath(pathname: string): string | null {
  const path = pathname.split("?")[0]?.split("#")[0] ?? "";
  if (exactPaths.has(path)) return path;
  if (/^\/blog\/[a-z0-9-]{1,80}$/.test(path)) return path;
  return null;
}

/** A campaign label is a short public token. A click id is never a label. */
export function landingCampaignLabel(utmCampaign: string | null, campaignId: string | null): string {
  const campaign = utmCampaign?.trim() ?? "";
  if (/^[A-Za-z0-9_-]{1,40}$/.test(campaign)) return campaign;
  const id = campaignId?.trim() ?? "";
  if (/^[0-9]{1,32}$/.test(id)) return id;
  return landingLoadNone;
}

/**
 * Folds a new label into the overflow bucket once a day already has the cap.
 * Labels already counted that day stay on their own row.
 */
export function assignCampaignLabel(existingLabels: readonly string[], label: string): string {
  if (label === landingLoadOverflow || existingLabels.includes(label)) return label;
  if (new Set(existingLabels).size >= landingCampaignCap) return landingLoadOverflow;
  return label;
}

/** Builds the only fields stored for a page load. Consent is not an input. */
export function landingLoadFromLocation(href: string, referrer: string): LandingLoadRecord | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  const path = landingLoadPath(url.pathname);
  if (!path) return null;
  const touch = touchFromLocation(url, referrer);
  return {
    path,
    source: classifySource({ utmSource: touch.utmSource, referrerHost: touch.referrerHost }),
    campaign: landingCampaignLabel(touch.utmCampaign, touch.metaCampaignId),
  };
}
