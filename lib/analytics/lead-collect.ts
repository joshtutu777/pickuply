"use client";

import { createClient } from "@/lib/supabase/client";
import { funnelSessionId } from "@/lib/funnel";
import {
  campaignFields,
  emptyTouch,
  leadWriteAllowed,
  touchFromLocation,
  type CampaignTouch,
} from "@/lib/analytics/attribution";

const stagesKey = "pickuply.lead-stages";
const touchKey = "pickuply.lead-touch";

function readConsent(): "granted" | "denied" | "unknown" {
  try {
    const value = localStorage.getItem("pickuply-analytics-consent");
    return value === "granted" || value === "denied" ? value : "unknown";
  } catch {
    return "unknown";
  }
}

function claimStage(key: string): boolean {
  try {
    const raw = sessionStorage.getItem(stagesKey);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    const seen = new Set<string>(Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string") : []);
    if (seen.has(key)) return false;
    seen.add(key);
    sessionStorage.setItem(stagesKey, JSON.stringify([...seen].slice(-80)));
    return true;
  } catch {
    return true;
  }
}

function mergeTouch(previous: CampaignTouch, next: CampaignTouch): CampaignTouch {
  return {
    landingPath: next.landingPath ?? previous.landingPath,
    referrerHost: next.referrerHost ?? previous.referrerHost,
    utmSource: next.utmSource ?? previous.utmSource,
    utmMedium: next.utmMedium ?? previous.utmMedium,
    utmCampaign: next.utmCampaign ?? previous.utmCampaign,
    utmContent: next.utmContent ?? previous.utmContent,
    utmTerm: next.utmTerm ?? previous.utmTerm,
    metaCampaignId: next.metaCampaignId ?? previous.metaCampaignId,
    metaAdsetId: next.metaAdsetId ?? previous.metaAdsetId,
    metaAdId: next.metaAdId ?? previous.metaAdId,
    fbclid: next.fbclid ?? previous.fbclid,
  };
}

function rememberTouch(current: CampaignTouch): CampaignTouch {
  let last = current;
  try {
    const raw = sessionStorage.getItem(touchKey);
    if (raw) {
      const parsed = JSON.parse(raw) as { last?: CampaignTouch };
      last = mergeTouch(parsed.last ?? emptyTouch(), current);
    }
    sessionStorage.setItem(touchKey, JSON.stringify({ last }));
  } catch {
    return current;
  }
  return last;
}

export function clearLeadTouch(): void {
  try {
    sessionStorage.removeItem(touchKey);
    sessionStorage.removeItem(stagesKey);
  } catch {
    return;
  }
}

/**
 * Records one anonymous step after analytics cookies are allowed.
 * Rejection stores nothing. A failure never blocks the page.
 */
export async function recordLeadStage(stage: string, service?: string | null): Promise<void> {
  if (typeof window === "undefined") return;
  const consent = readConsent();
  if (consent === "denied") {
    clearLeadTouch();
    return;
  }
  const current = touchFromLocation(new URL(window.location.href), document.referrer);
  const stored = rememberTouch(current);
  if (!leadWriteAllowed(consent)) return;
  const key = service ? `${stage}:${service}` : stage;
  if (!claimStage(key)) return;
  const touch = campaignFields(stored, "granted");
  try {
    await createClient().rpc("record_lead_activity", {
      browser_session: funnelSessionId(),
      stage_name: stage,
      service_name: service || null,
      consent_choice: "granted",
      landing_path: current.landingPath,
      referrer_host: current.referrerHost,
      utm_source: touch.utmSource,
      utm_medium: touch.utmMedium,
      utm_campaign: touch.utmCampaign,
      utm_content: touch.utmContent,
      utm_term: touch.utmTerm,
      click_id: touch.fbclid,
      meta_campaign_id: touch.metaCampaignId,
      meta_adset_id: touch.metaAdsetId,
      meta_ad_id: touch.metaAdId,
    });
  } catch {
    return;
  }
}

/** Copies the session campaign onto the saved request. The browsing history stays off the request. */
export async function attachJobAttribution(jobId: string): Promise<void> {
  if (typeof window === "undefined" || !leadWriteAllowed(readConsent())) return;
  try {
    await createClient().rpc("attach_job_attribution", {
      target_job: jobId,
      browser_session: funnelSessionId(),
    });
  } catch {
    return;
  }
}
