import { addDays, isWithinBookingWindow } from "../dates";

export const pickupTimeZone = "America/New_York";

export const pickupLeadMinutes = 60;

export const defaultOfferArrivalLeadMinutes = 30;

export const scheduleLockedMessage =
  "This pickup time is locked. To change it, contact Pickuply support.";

export type PickupAvailability = "anytime" | "asap" | "windows";

export type PickupWindowDraft = {
  date: string;
  start: string;
  end: string;
};

export type PickupWindowPlan = {
  id: string;
  starts_at: string;
  ends_at: string;
  position: number;
};

export type PickupPlan = {
  availability: PickupAvailability | null;
  timezone: string | null;
  windows: PickupWindowPlan[];
};

const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

export function georgiaDateISO(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: pickupTimeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const pick = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${pick("year")}-${pick("month")}-${pick("day")}`;
}

export function addCalendarDays(isoDate: string, days: number): string {
  return addDays(isoDate, days);
}

export function isGeorgiaBookingDate(isoDate: string, now = new Date()): boolean {
  return isWithinBookingWindow(isoDate, georgiaDateISO(now));
}

function wallClock(moment: Date, timeZone = pickupTimeZone): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(moment);
  const pick = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  const hour = pick("hour") === "24" ? "00" : pick("hour");
  return {
    date: `${pick("year")}-${pick("month")}-${pick("day")}`,
    time: `${hour}:${pick("minute")}`,
  };
}

/** The pickup instant for a Georgia wall-clock date and time. The server stores the same instant. */
export function zonedWallTime(date: string, time: string, timeZone = pickupTimeZone): Date {
  if (!datePattern.test(date) || !timePattern.test(time)) {
    throw new Error("Enter a pickup date and time.");
  }
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const desired = Date.UTC(year, month - 1, day, hour, minute, 0);
  let utc = desired;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const wall = wallClock(new Date(utc), timeZone);
    const [wallYear, wallMonth, wallDay] = wall.date.split("-").map(Number);
    const [wallHour, wallMinute] = wall.time.split(":").map(Number);
    const asUtc = Date.UTC(wallYear, wallMonth - 1, wallDay, wallHour, wallMinute, 0);
    const delta = desired - asUtc;
    if (delta === 0) break;
    utc += delta;
  }
  const check = wallClock(new Date(utc), timeZone);
  if (check.date !== date || check.time !== time) {
    throw new Error("That time does not exist in the pickup time zone.");
  }
  return new Date(utc);
}

export function addClockMinutes(time: string, minutes: number): string | null {
  if (!timePattern.test(time)) return null;
  const [hour, minute] = time.split(":").map(Number);
  const total = hour * 60 + minute + minutes;
  if (total < 0 || total >= 24 * 60) return null;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

export function coarseWindow(time: string): "morning" | "afternoon" | "evening" {
  const hour = Number(time.slice(0, 2));
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  return "evening";
}

function rangesOverlap(left: { start: number; end: number }, right: { start: number; end: number }): boolean {
  return left.start < right.end && right.start < left.end;
}

const presetSlots = [
  { start: "09:00", end: "11:00" },
  { start: "13:00", end: "15:00" },
  { start: "16:00", end: "18:00" },
] as const;

/** The next morning, afternoon, or evening preset that has not ended and is inside the booking window. */
export function nextOpenPreset(existing: PickupWindowDraft[] = [], now = new Date()): PickupWindowDraft | null {
  const today = georgiaDateISO(now);
  for (let day = 0; day <= 6; day += 1) {
    const date = addCalendarDays(today, day);
    for (const slot of presetSlots) {
      const candidate = { date, start: slot.start, end: slot.end };
      if (pickupWindowError([...existing, candidate], now) == null) return candidate;
    }
  }
  return null;
}

export function defaultPickupWindow(now = new Date()): PickupWindowDraft {
  return nextOpenPreset([], now) ?? { date: georgiaDateISO(now), start: "", end: "" };
}

export function extraPickupWindow(existing: PickupWindowDraft[], now = new Date()): PickupWindowDraft {
  return nextOpenPreset(existing, now) ?? { date: "", start: "", end: "" };
}

export function pickupWindowError(windows: PickupWindowDraft[], now = new Date()): string | null {
  if (windows.length < 1 || windows.length > 3) return "Add between 1 and 3 pickup windows.";
  const spans: { start: number; end: number }[] = [];
  for (const window of windows) {
    if (!datePattern.test(window.date) || !timePattern.test(window.start) || !timePattern.test(window.end)) {
      return "Enter a pickup date, start time, and end time.";
    }
    if (!isGeorgiaBookingDate(window.date, now)) return "Choose a date within the next 6 days.";
    let start: Date;
    let end: Date;
    try {
      start = zonedWallTime(window.date, window.start);
      end = zonedWallTime(window.date, window.end);
    } catch (error) {
      return error instanceof Error ? error.message : "Enter a pickup date and time.";
    }
    if (end.getTime() <= start.getTime()) return "The end time has to be later than the start time.";
    if (end.getTime() <= now.getTime()) return "A pickup window cannot be entirely in the past.";
    if (end.getTime() < now.getTime() + pickupLeadMinutes * 60 * 1000) {
      return "The pickup window has to end at least 60 minutes from now.";
    }
    const span = { start: start.getTime(), end: end.getTime() };
    if (spans.some((other) => rangesOverlap(span, other))) return "Pickup windows cannot overlap.";
    spans.push(span);
  }
  return null;
}

export function georgiaWallClock(iso: string): { date: string; time: string } {
  return wallClock(new Date(iso));
}

export function windowArrivalError(
  window: { starts_at: string; ends_at: string },
  time: string,
  now = new Date(),
): string | null {
  const start = new Date(window.starts_at);
  const end = new Date(window.ends_at);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end.getTime() <= now.getTime()) {
    return "That pickup window has passed. Choose another time.";
  }
  if (!timePattern.test(time)) return "Enter an arrival time inside the pickup window.";
  let arrival: Date;
  try {
    arrival = zonedWallTime(wallClock(start).date, time);
  } catch (error) {
    return error instanceof Error ? error.message : "Enter an arrival time inside the pickup window.";
  }
  if (arrival.getTime() < start.getTime() || arrival.getTime() > end.getTime()) {
    return "Choose an arrival inside the pickup window.";
  }
  if (arrival.getTime() <= now.getTime()) return "That pickup time has passed. Choose a later time.";
  return null;
}

export function arrivalError(
  date: string,
  time: string,
  now = new Date(),
  leadMinutes = defaultOfferArrivalLeadMinutes,
): string | null {
  if (!datePattern.test(date) || !timePattern.test(time)) return "Enter the pickup date and arrival time.";
  if (!isGeorgiaBookingDate(date, now)) return "Choose a pickup time within the next 6 days.";
  try {
    const arrival = zonedWallTime(date, time);
    if (arrival.getTime() <= now.getTime()) return "That pickup time has passed. Choose a later time.";
    if (leadMinutes > 0 && arrival.getTime() < now.getTime() + leadMinutes * 60 * 1000) {
      return `Choose an arrival at least ${leadMinutes} minutes from now.`;
    }
  } catch (error) {
    return error instanceof Error ? error.message : "Enter the pickup date and arrival time.";
  }
  return null;
}

export function availabilityError(
  availability: string,
  windows: PickupWindowDraft[],
  now = new Date(),
): string | null {
  if (availability === "anytime" || availability === "asap") {
    return windows.length > 0 ? "This choice does not use pickup windows." : null;
  }
  if (availability === "windows") return pickupWindowError(windows, now);
  return "Choose when the item is available for pickup.";
}

export function legacyWhen(availability: PickupAvailability, windows: PickupWindowDraft[]) {
  if (availability === "windows" && windows[0] && datePattern.test(windows[0].date) && timePattern.test(windows[0].start)) {
    return {
      preferred_date: windows[0].date,
      time_window: coarseWindow(windows[0].start),
    };
  }
  return { preferred_date: "asap", time_window: null as string | null };
}

function clockLabel(moment: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: pickupTimeZone,
    hour: "numeric",
    minute: "2-digit",
  }).formatToParts(moment);
  const pick = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${pick("hour")}:${pick("minute")} ${pick("dayPeriod")}`.replace(/\s+/g, " ").trim();
}

function dayLabel(moment: Date, now: Date): string {
  const day = georgiaDateISO(moment);
  const today = georgiaDateISO(now);
  if (day === today) return "Today";
  if (day === addCalendarDays(today, 1)) return "Tomorrow";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: pickupTimeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(moment);
}

export function formatOfferWhen(startIso: string, endIso: string | null, now = new Date()): string {
  const start = new Date(startIso);
  if (Number.isNaN(start.getTime())) return "Pickup time unavailable";
  const day = dayLabel(start, now);
  if (!endIso) return `${day}, ${clockLabel(start)}`;
  const end = new Date(endIso);
  if (Number.isNaN(end.getTime())) return `${day}, ${clockLabel(start)}`;
  return `${day}, ${clockLabel(start).replace(/ [AP]M$/, "")}–${clockLabel(end)}`;
}

export function formatScheduledPickup(startIso: string, endIso: string | null): string {
  return formatOfferWhen(startIso, endIso);
}

export function availabilitySummary(availability: PickupAvailability, windows: PickupWindowDraft[]): string {
  if (availability === "anytime") {
    return "Available anytime. The driver will propose a pickup time and will not arrive unannounced.";
  }
  if (availability === "asap") {
    return "As soon as possible. The driver will propose their earliest realistic arrival. This does not promise an immediate pickup.";
  }
  if (windows.length === 0) return "No pickup windows yet.";
  return windows
    .map((window, index) => `Window ${index + 1}: ${window.date}, ${window.start}–${window.end} ET`)
    .join(". ");
}

export function windowIsOpen(endsAt: string, now = new Date()): boolean {
  const end = new Date(endsAt);
  return !Number.isNaN(end.getTime()) && end.getTime() > now.getTime();
}
