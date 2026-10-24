export type RestrictionNotice = {
  body: string;
  until: string | null;
};

const customerTemporary =
  "Your Pickuply account is temporarily restricted. You cannot create or book new pickups while this restriction is active.";
const customerIndefinite =
  "Your Pickuply account is restricted. You cannot create or book new pickups while this restriction is active.";
const driverRestricted =
  "Your Pickuply driver account is restricted. You cannot submit offers or accept new jobs while this restriction is active.";

export const phoneReuseNotice =
  "This phone number cannot be used for Pickuply right now. Contact support if you think this is a mistake.";

export function formatInNewYork(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
}

export function wallTimeInNewYork(year: number, month: number, day: number, hour: number, minute: number): Date {
  const formatted = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  let guess = Date.UTC(year, month - 1, day, hour + 5, minute, 0);
  const wanted = Date.UTC(year, month - 1, day, hour, minute, 0);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const parts = formatted.formatToParts(new Date(guess));
    const read = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? "0");
    const seen = Date.UTC(read("year"), read("month") - 1, read("day"), read("hour"), read("minute"), 0);
    if (seen === wanted) return new Date(guess);
    guess += wanted - seen;
  }
  return new Date(guess);
}

export function parseNyDateTime(value: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const [, year, month, day, hour, minute] = match.map(Number);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null;
  return wallTimeInNewYork(year, month, day, hour, minute).toISOString();
}

export function restrictionNotice(
  surface: "customer" | "driver",
  value: unknown,
): RestrictionNotice | null {
  if (!value || typeof value !== "object") return null;
  const row = value as { active?: unknown; kind?: unknown; expires_at?: unknown };
  if (row.active !== true) return null;
  const expires = typeof row.expires_at === "string" ? row.expires_at : null;
  const temporary = row.kind === "temporary" && expires;
  if (surface === "driver") {
    return {
      body: driverRestricted,
      until: temporary ? formatInNewYork(expires) : null,
    };
  }
  return {
    body: temporary ? customerTemporary : customerIndefinite,
    until: temporary ? formatInNewYork(expires) : null,
  };
}

export function blockerLabel(code: string): string {
  if (code === "active_job") return "Active job";
  if (code === "open_payment") return "Payment still open";
  if (code === "open_dispute") return "Open dispute";
  if (code === "open_earnings") return "Earnings not finished";
  if (code === "recovery_due") return "Recovery still owed";
  return "Needs review";
}
