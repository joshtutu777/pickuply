"use server";

import { loadVisitActivity } from "@/lib/admin/lead-load";
import { leadRange, visitRangePresets, type VisitRangePreset } from "@/lib/admin/lead-metrics";
import { requireAdmin } from "@/lib/auth/session";

const presetSet = new Set<string>(visitRangePresets);

function dateOrBlank(value: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
}

/** Loads anonymous visit steps for an admin. Customer, payment, and job rows are not selected. */
export async function loadVisitFunnelRange(input: { preset: string; from: string; to: string; now: string }) {
  await requireAdmin("/admin/analytics/leads");
  if (!presetSet.has(input.preset)) return { ok: false as const, reason: "That date range is not available." };
  const parsed = new Date(input.now);
  const clock = Number.isFinite(parsed.getTime()) && Math.abs(parsed.getTime() - Date.now()) < 2 * 86_400_000 ? parsed : new Date();
  const range = leadRange(input.preset as VisitRangePreset, dateOrBlank(input.from), dateOrBlank(input.to), clock);
  if (range.end.getTime() - range.start.getTime() > 366 * 86_400_000) {
    return { ok: false as const, reason: "Choose a range of one year or less." };
  }
  const loaded = await loadVisitActivity(range.start, range.end);
  if (loaded.error) return { ok: false as const, reason: loaded.error };
  return {
    ok: true as const,
    start: range.start.toISOString(),
    end: range.end.toISOString(),
    events: loaded.events,
    visits: loaded.visits,
    capped: loaded.capped,
  };
}
