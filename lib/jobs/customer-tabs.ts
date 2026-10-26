export type CustomerTab = "requests" | "active" | "history";

const historyStatuses = new Set(["completed", "cancelled", "expired"]);
const activeStatuses = new Set([
  "assigned",
  "en_route",
  "arrived",
  "item_check",
  "in_transit",
  "delivered",
  "disputed",
]);

/** Each customer job belongs to one list. Retired work is history even if its status is still open. */
export function customerJobTab(job: { status: string; retired?: boolean }): CustomerTab {
  if (job.retired || historyStatuses.has(job.status)) return "history";
  if (activeStatuses.has(job.status)) return "active";
  return "requests";
}

export function customerListStatus(input: {
  status: string;
  pricingMethod: string;
  activeOffers: number;
  retired?: boolean;
}): string {
  if (input.retired) return "Closed";
  if (input.status === "cancelled") return "Cancelled";
  if (input.status === "expired") return "Expired";
  if (input.status === "completed") return "Delivery complete";
  if (input.status === "disputed") return "Paused for a problem report";
  if (input.status === "delivered") return "Awaiting your confirmation";
  if (input.status === "item_check") return "Pickup review";
  if (input.status === "in_transit") return "On the way to drop-off";
  if (input.status === "arrived") return "Arrived at pickup";
  if (input.status === "en_route") return "Driver on the way";
  if (input.status === "assigned") return "Booked";
  if (input.status === "quoted") return "Your price is ready";
  if ((input.status === "requested" || input.status === "in_review") && input.pricingMethod === "quote") {
    return "Preparing your price";
  }
  if (input.status === "open" && input.activeOffers > 0) return "Offers Received";
  if (input.status === "open") return "No offers yet";
  return "Request received";
}

export function customerCardAction(input: {
  status: string;
  paymentStatus: string | null;
  activeOffers: number;
}): string {
  const unpaid = input.paymentStatus === "awaiting_payment" || input.paymentStatus === "failed";
  if (input.status === "delivered" || input.status === "item_check") return "Review Delivery";
  if (input.status === "assigned" && unpaid) return "Confirm booking";
  if (input.status === "completed") return "View receipt";
  if (activeStatuses.has(input.status)) return "Track Delivery";
  if (input.activeOffers > 0 || input.status === "open" || input.status === "quoted") return "View Offers";
  return "View request";
}
