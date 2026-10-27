export type CustomerNextAction = {
  label: string;
};

const payNow = new Set(["awaiting_payment", "failed"]);
const progress = new Set(["assigned", "en_route", "arrived", "item_check", "in_transit"]);

/** The label on a customer job card. It follows status and payment, not a guess. */
export function customerNextAction(input: {
  status: string;
  paymentStatus: string | null;
  pricingMethod: string;
}): CustomerNextAction {
  if (input.status === "quoted") return { label: "Review quote" };
  if (input.status === "open" && input.pricingMethod !== "quote") return { label: "Select an offer" };
  if (input.status === "assigned" && payNow.has(input.paymentStatus ?? "")) return { label: "Confirm booking" };
  if (input.status === "delivered") return { label: "Confirm delivery" };
  if (progress.has(input.status)) return { label: "View driver progress" };
  return { label: "View request" };
}

const activeRank: Record<string, number> = {
  item_check: 1,
  delivered: 2,
  assigned: 3,
  en_route: 4,
  arrived: 5,
  in_transit: 6,
  quoted: 7,
  open: 8,
  requested: 9,
  in_review: 10,
  disputed: 11,
};

export function pickCurrentJob<T extends { status: string; updated_at: string }>(jobs: T[]): T | null {
  const ranked = jobs.filter((job) => activeRank[job.status] != null);
  ranked.sort((a, b) => {
    const rank = (activeRank[a.status] ?? 99) - (activeRank[b.status] ?? 99);
    if (rank !== 0) return rank;
    return b.updated_at.localeCompare(a.updated_at);
  });
  return ranked[0] ?? null;
}

export function shortJobId(id: string): string {
  return id.replaceAll("-", "").slice(-6).toUpperCase();
}

export function cityFromArea(area: string | null | undefined): string | null {
  const city = area?.split(",")[0]?.trim() ?? "";
  if (!city || /^\d{5}$/.test(city)) return null;
  return city;
}
