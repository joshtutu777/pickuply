import { sourceLabel, type AttributionSource } from "@/lib/analytics/attribution";

export type LandingLoadRow = {
  countedOn: string;
  path: string;
  source: AttributionSource;
  campaign: string;
  loads: number;
};

const sources = new Set<string>(["facebook", "instagram", "google", "direct", "referral", "other", "unknown"]);

export function landingLoadRows(rows: {
  counted_on: string;
  landing_path: string;
  source_category: string;
  campaign_label: string;
  load_count: number;
}[]): LandingLoadRow[] {
  return rows.flatMap((row) => {
    if (!sources.has(row.source_category) || !Number.isInteger(row.load_count) || row.load_count < 0) return [];
    return [{
      countedOn: row.counted_on,
      path: row.landing_path,
      source: row.source_category as AttributionSource,
      campaign: row.campaign_label,
      loads: row.load_count,
    }];
  });
}

export function landingLoadSourceLabel(source: AttributionSource): string {
  return sourceLabel(source);
}
