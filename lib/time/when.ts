const georgia = "America/New_York";

/** US display for a stored UTC timestamp, shown in the Georgia pickup zone. */
export function formatUsWhen(iso: string, timeZone = georgia): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).formatToParts(date);
  const pick = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${pick("weekday")}, ${pick("month")} ${pick("day")} · ${pick("hour")}:${pick("minute")} ${pick("dayPeriod")}`;
}

/** A calendar day such as 2026-10-27, without shifting it into the previous evening. */
export function formatUsDay(value: string, timeZone = georgia): string {
  if (!/^\d{4}-\d{2}-\d{2}/.test(value)) return value;
  const date = new Date(`${value.slice(0, 10)}T12:00:00Z`);
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(date);
}
