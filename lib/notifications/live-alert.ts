export type AlertPrefs = {
  sound: boolean;
  newJobs: boolean;
  messages: boolean;
  delivery: boolean;
};

export const defaultAlertPrefs: AlertPrefs = {
  sound: true,
  newJobs: true,
  messages: true,
  delivery: true,
};

const jobKinds = new Set(["new_job", "new_request"]);
const messageKinds = new Set(["new_message"]);
const deliveryKinds = new Set([
  "en_route",
  "arrived",
  "item_check",
  "picked_up",
  "delivered",
  "dropoff_arrived",
  "completed",
  "assigned",
  "driver_confirmed",
  "payment_needed",
  "payment_confirmed",
  "offer",
  "quote_ready",
  "request_received",
  "disputed",
  "cancelled",
]);

export type AlertCategory = "jobs" | "messages" | "delivery" | "other";

export function alertCategory(kind: string): AlertCategory {
  if (jobKinds.has(kind)) return "jobs";
  if (messageKinds.has(kind)) return "messages";
  if (deliveryKinds.has(kind)) return "delivery";
  return "other";
}

/** Category toggles hide that toast. Other alerts stay. Sound is a separate switch. */
export function alertAllowed(kind: string, prefs: AlertPrefs): boolean {
  const category = alertCategory(kind);
  if (category === "jobs") return prefs.newJobs;
  if (category === "messages") return prefs.messages;
  if (category === "delivery") return prefs.delivery;
  return true;
}

export function shouldPlaySound(input: { allowed: boolean; soundOn: boolean; visible: boolean }): boolean {
  return input.allowed && input.soundOn && input.visible;
}

/** The first caller claims the id. Later callers, including other tabs, do not play again. */
export function claimAlert(id: string, seen: Set<string>): boolean {
  if (seen.has(id)) return false;
  seen.add(id);
  return true;
}
