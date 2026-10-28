const zone = "America/New_York";

export function areaLabel(area: string | null | undefined): string {
  const city = (area?.split(",")[0]?.trim() ?? "").replace(/\s+\d{5}(?:-\d{4})?$/, "");
  if (!city || /^\d/.test(city)) return "";
  return city;
}

export function routeLabel(pickup: string | null | undefined, dropoff: string | null | undefined): string {
  const from = areaLabel(pickup);
  const to = areaLabel(dropoff);
  if (from && to) return `${from} → ${to}`;
  return from || to;
}

export function previewSnippet(body: string | null | undefined): string {
  const clean = (body ?? "").replace(/\s+/g, " ").trim();
  if (clean.length <= 80) return clean;
  return `${clean.slice(0, 77)}...`;
}

export function unreadLabel(count: number): string {
  if (count <= 0) return "";
  if (count === 1) return "1 unread";
  return `${count} unread`;
}

export function messageClock(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function messageDay(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(date);
}

export function messagePreviewText(input: {
  name: string;
  role: string;
  jobLabel?: string | null;
  pickup?: string | null;
  dropoff?: string | null;
  snippet?: string | null;
  unread?: number;
  at?: string | null;
}): string {
  const route = routeLabel(input.pickup, input.dropoff);
  const context = [input.jobLabel, route].filter(Boolean).join(" · ");
  const meta = [unreadLabel(input.unread ?? 0), messageClock(input.at)].filter(Boolean).join(" · ");
  return [ `${input.name} — ${input.role}`, context, input.snippet ? `"${previewSnippet(input.snippet)}"` : "", meta ]
    .filter(Boolean)
    .join("\n");
}
