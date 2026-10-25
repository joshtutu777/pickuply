const STOP_LINE = "Reply STOP to opt out.";

export function withPickuplyPrefix(body: string): string {
  const trimmed = body.trim();
  if (trimmed.toLowerCase().startsWith("pickuply:")) return trimmed;
  return `Pickuply: ${trimmed}`;
}

export function promotionalSms(body: string): string {
  const prefixed = withPickuplyPrefix(body);
  if (prefixed.toLowerCase().includes("reply stop")) return prefixed;
  return `${prefixed} ${STOP_LINE}`;
}

/** GSM-7 segment count. The prefix and STOP line are included. */
export function smsSegments(body: string): number {
  if (body.length <= 160) return 1;
  return Math.ceil(body.length / 153);
}

export function quietWindow(now: Date): { allowed: boolean; sendAt: Date } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const read = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? "0");
  const hour = read("hour");
  const minute = read("minute");
  const minutes = hour * 60 + minute;
  const open = 8 * 60;
  const close = 21 * 60;
  if (minutes >= open && minutes < close) return { allowed: true, sendAt: now };
  const year = read("year");
  const month = read("month");
  const day = read("day");
  const rolled = new Date(Date.UTC(year, month - 1, day + (minutes < open ? 0 : 1)));
  const resolved = resolveNyWall(rolled.getUTCFullYear(), rolled.getUTCMonth() + 1, rolled.getUTCDate(), 8, 0);
  if ("error" in resolved) return { allowed: false, sendAt: now };
  return { allowed: false, sendAt: resolved.utc };
}

export function resolveNyWall(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): { utc: Date } | { error: "ambiguous" | "missing" } {
  const matches: Date[] = [];
  for (const offsetHours of [4, 5]) {
    const candidate = new Date(Date.UTC(year, month - 1, day, hour + offsetHours, minute, 0));
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(candidate);
    const read = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? "0");
    if (read("year") === year && read("month") === month && read("day") === day && read("hour") === hour && read("minute") === minute) {
      matches.push(candidate);
    }
  }
  if (matches.length === 0) return { error: "missing" };
  if (matches.length > 1) return { error: "ambiguous" };
  return { utc: matches[0] };
}
