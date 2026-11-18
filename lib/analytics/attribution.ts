/** Campaign fields from the page address. Nothing here is a customer name, phone, or message. */

export const attributionSources = [
  "facebook",
  "instagram",
  "google",
  "direct",
  "referral",
  "other",
  "unknown",
] as const;

export type AttributionSource = (typeof attributionSources)[number];

export type CampaignTouch = {
  landingPath: string | null;
  referrerHost: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  utmTerm: string | null;
  metaCampaignId: string | null;
  metaAdsetId: string | null;
  metaAdId: string | null;
  fbclid: string | null;
};

const ownHosts = ["pickuplyapp.com", "www.pickuplyapp.com", "localhost"];

export function emptyTouch(): CampaignTouch {
  return {
    landingPath: null,
    referrerHost: null,
    utmSource: null,
    utmMedium: null,
    utmCampaign: null,
    utmContent: null,
    utmTerm: null,
    metaCampaignId: null,
    metaAdsetId: null,
    metaAdId: null,
    fbclid: null,
  };
}

function cleanPath(value: string): string | null {
  const path = value.split("?")[0]?.split("#")[0] ?? "";
  if (!path.startsWith("/") || path.length > 120) return null;
  if (!/^\/[A-Za-z0-9_./-]*$/.test(path)) return null;
  return path;
}

function cleanToken(value: string | null, max: number): string | null {
  if (!value) return null;
  const text = value.trim();
  if (!text || text.length > max) return null;
  if (!/^[A-Za-z0-9 ._+|-]+$/.test(text)) return null;
  return text;
}

function cleanId(value: string | null): string | null {
  if (!value) return null;
  const text = value.trim();
  return /^[0-9]{1,32}$/.test(text) ? text : null;
}

function cleanClickId(value: string | null): string | null {
  if (!value) return null;
  const text = value.trim();
  return /^[A-Za-z0-9_-]{1,200}$/.test(text) ? text : null;
}

export function hostFromReferrer(referrer: string): string | null {
  if (!referrer) return null;
  try {
    const host = new URL(referrer).hostname.toLowerCase().replace(/\.$/, "");
    if (!host || host.length > 120) return null;
    if (!/^[a-z0-9.-]+$/.test(host)) return null;
    return host;
  } catch {
    return null;
  }
}

/** Reads the current address. A click id is kept only as the raw parameter, never turned into a campaign. */
export function touchFromLocation(url: URL, referrer: string): CampaignTouch {
  const params = url.searchParams;
  return {
    landingPath: cleanPath(url.pathname),
    referrerHost: hostFromReferrer(referrer),
    utmSource: cleanToken(params.get("utm_source"), 80),
    utmMedium: cleanToken(params.get("utm_medium"), 80),
    utmCampaign: cleanToken(params.get("utm_campaign"), 120),
    utmContent: cleanToken(params.get("utm_content"), 120),
    utmTerm: cleanToken(params.get("utm_term"), 120),
    metaCampaignId: cleanId(params.get("campaign_id")),
    metaAdsetId: cleanId(params.get("adset_id")),
    metaAdId: cleanId(params.get("ad_id")),
    fbclid: cleanClickId(params.get("fbclid")),
  };
}

export function campaignFields(touch: CampaignTouch, consent: "granted" | "denied" | "unknown"): CampaignTouch {
  if (consent === "granted") return touch;
  return {
    ...touch,
    utmSource: null,
    utmMedium: null,
    utmCampaign: null,
    utmContent: null,
    utmTerm: null,
    metaCampaignId: null,
    metaAdsetId: null,
    metaAdId: null,
    fbclid: null,
  };
}

function hostIs(host: string | null, names: string[]): boolean {
  if (!host) return false;
  return names.some((name) => host === name || host.endsWith(`.${name}`));
}

/**
 * Last-touch or first-touch inputs that were actually stored.
 * A click id never selects a campaign by itself.
 */
export function classifySource(input: { utmSource: string | null; referrerHost: string | null }): AttributionSource {
  const source = input.utmSource?.trim().toLowerCase() ?? "";
  if (source === "facebook" || source === "fb" || source === "meta") return "facebook";
  if (source === "instagram" || source === "ig") return "instagram";
  if (source === "google" || source === "adwords" || source === "googleads") return "google";
  if (source === "direct" || source === "(direct)") return "direct";
  if (source) return "other";
  if (hostIs(input.referrerHost, ["facebook.com", "fb.com"])) return "facebook";
  if (hostIs(input.referrerHost, ["instagram.com"])) return "instagram";
  if (hostIs(input.referrerHost, ["google.com"])) return "google";
  if (input.referrerHost && !hostIs(input.referrerHost, ownHosts)) return "referral";
  if (!input.referrerHost) return "direct";
  return "unknown";
}

/** A visit is stored only after the visitor allows analytics cookies. */
export function leadWriteAllowed(consent: string): boolean {
  return consent === "granted";
}

export function sourceLabel(source: AttributionSource): string {
  if (source === "facebook") return "Facebook";
  if (source === "instagram") return "Instagram";
  if (source === "google") return "Google";
  if (source === "direct") return "Direct";
  if (source === "referral") return "Referral";
  if (source === "other") return "Other";
  return "Unknown";
}
