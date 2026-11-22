"use client";

import { landingLoadFromLocation } from "@/lib/analytics/landing-load";
import { createClient } from "@/lib/supabase/client";

let lastKey = "";

/** Adds one landing load. A failure stays on the page and is not retried for the same address. */
export async function recordLandingLoad(href: string, referrer: string): Promise<boolean> {
  const record = landingLoadFromLocation(href, referrer);
  if (!record) return false;
  const key = `${record.path}\n${record.source}\n${record.campaign}`;
  if (key === lastKey) return false;
  lastKey = key;
  try {
    await createClient().rpc("record_landing_load", {
      page_path: record.path,
      source_name: record.source,
      campaign_name: record.campaign,
    });
    return true;
  } catch {
    return false;
  }
}
