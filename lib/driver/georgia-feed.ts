/** Read a one-number database function result. A missing result stays 0. */
export function rpcCount(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  if (Array.isArray(value)) return value.length === 1 ? rpcCount(value[0]) : 0;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const nested = record.driver_georgia_count ?? record.count;
    if (nested != null) return rpcCount(nested);
  }
  return 0;
}

/**
 * All Georgia Requests lists eligible open jobs outside the driver's saved areas.
 * Jobs that match coverage stay in Matched for You and are not counted again.
 */
export function georgiaSectionNote(input: {
  loaded: boolean;
  matched: number;
  shown: number;
  filteredTotal: number;
  unfilteredTotal: number;
}): string | null {
  if (!input.loaded || input.shown > 0) return null;
  if (input.unfilteredTotal > 0 && input.filteredTotal === 0) return "No requests match these filters.";
  if (input.matched > 0) {
    return "These open requests are already under Matched for You. All Georgia Requests only lists jobs outside your saved areas.";
  }
  return "No open requests in Georgia right now.";
}
