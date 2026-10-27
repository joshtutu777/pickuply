const pickupServices = new Set(["delivery", "free_item", "junk"]);
const activeAfterStart = new Set(["en_route", "arrived", "item_check", "in_transit", "delivered", "completed"]);
const activeAfterArrival = new Set(["arrived", "item_check", "in_transit", "delivered", "completed"]);

export const pilotSmsKinds = [
  "new_job",
  "offer",
  "assigned",
  "driver_confirmed",
  "en_route",
  "arrived",
  "delivered",
  "driver_approved",
] as const;

export type PilotSmsKind = (typeof pilotSmsKinds)[number];

export function smsArea(value: string | null | undefined): string {
  const cleaned = (value ?? "").replace(/\s+/g, " ").trim();
  if (!cleaned || cleaned.length > 40 || /\d/.test(cleaned) || cleaned.includes("@")) return "your area";
  return cleaned;
}

export function pilotSmsText(input: {
  kind: string;
  area?: string | null;
  service?: string | null;
  jobStatus?: string | null;
  driverStatus?: string | null;
}): string | null {
  const status = input.jobStatus ?? "";
  if (status === "cancelled" || status === "disputed") return null;

  switch (input.kind) {
    case "new_job":
      if (status !== "open" || !pickupServices.has(input.service ?? "")) return null;
      return `Pickuply: New pickup request in ${smsArea(input.area)}. Open Pickuply to view details and send your offer.`;
    case "offer":
      if (status !== "open") return null;
      return "Pickuply: A driver has sent you an offer for your pickup. Open Pickuply to review and compare offers.";
    case "assigned":
      if (!["assigned", ...activeAfterStart].includes(status)) return null;
      return "Pickuply: Your offer was accepted! Open Pickuply to review the job and next steps.";
    case "driver_confirmed":
      if (!["assigned", ...activeAfterStart].includes(status)) return null;
      return "Pickuply: Your driver is confirmed. You'll receive updates as your pickup progresses.";
    case "en_route":
      if (!activeAfterStart.has(status)) return null;
      return "Pickuply: Your driver is on the way to the pickup location. Track your job in Pickuply.";
    case "arrived":
      if (!activeAfterArrival.has(status)) return null;
      return "Pickuply: Your driver has arrived at the pickup location.";
    case "delivered":
      if (status !== "delivered") return null;
      return "Pickuply: Your job is marked complete. Please review the photos and confirm everything looks good.";
    case "driver_approved":
      if (!["approved_new", "active"].includes(input.driverStatus ?? "")) return null;
      return "Pickuply: Your driver application has been approved! Complete any remaining setup to start receiving jobs.";
    default:
      return null;
  }
}
