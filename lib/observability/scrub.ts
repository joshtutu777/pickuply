const redacted = "[redacted]";
const emailPattern = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const uuidPattern = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;
const phonePattern = /(?:\+\d{1,3}[\s.-]?)?(?:\(?\d{3}\)?[\s.-]*)\d{3}[\s.-]\d{4}\b/g;
const e164Pattern = /\+\d{10,15}\b/g;
const secretPattern = /Bearer\s+\S+|sk_(?:test|live)_\S+|whsec_\S+/gi;

export type ReportEvent = {
  message?: string;
  user?: { id?: string; email?: string; username?: string; ip_address?: string | null } | null;
  request?: {
    url?: string;
    cookies?: unknown;
    headers?: Record<string, string | string[] | undefined>;
    data?: unknown;
    query_string?: unknown;
  };
  exception?: { values?: Array<{ value?: string; type?: string }> };
  extra?: Record<string, unknown> | null;
  tags?: Record<string, unknown> | null;
  breadcrumbs?: Array<{ message?: string; data?: Record<string, unknown> }> | null;
  contexts?: Record<string, unknown> | null;
};

/** Last four characters only, so a customer id is not sent in the clear. */
export function maskId(id: string): string {
  const tail = id.replace(/-/g, "").slice(-4);
  return `••••${tail}`;
}

export function scrubText(value: string): string {
  return value
    .replace(secretPattern, redacted)
    .replace(emailPattern, redacted)
    .replace(uuidPattern, (id) => maskId(id))
    .replace(phonePattern, redacted)
    .replace(e164Pattern, redacted);
}

export function browserName(userAgent: string): string {
  if (/edg\//i.test(userAgent)) return "Edge";
  if (/firefox\//i.test(userAgent)) return "Firefox";
  if (/chrome\//i.test(userAgent) || /crios\//i.test(userAgent)) return "Chrome";
  if (/safari\//i.test(userAgent)) return "Safari";
  return userAgent.trim() ? "Other" : "";
}

/** Keep the site and path. Drop the query string, where emails and tokens often travel. */
export function pageUrl(raw: string): string {
  try {
    const url = new URL(raw, "https://pickuplyapp.com");
    return raw.startsWith("/") ? url.pathname : `${url.origin}${url.pathname}`;
  } catch {
    return raw.split("?")[0]?.split("#")[0] ?? raw;
  }
}

function headerText(headers: NonNullable<ReportEvent["request"]>["headers"], name: string): string {
  if (!headers) return "";
  const found = Object.entries(headers).find(([key]) => key.toLowerCase() === name);
  const value = found?.[1];
  return Array.isArray(value) ? value.join(" ") : value ?? "";
}

function scrubUnknown(value: unknown, depth: number): unknown {
  if (depth > 6) return redacted;
  if (typeof value === "string") return scrubText(value);
  if (typeof value === "number" || typeof value === "boolean" || value == null) return value;
  if (Array.isArray(value)) return value.map((item) => scrubUnknown(item, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (/email|phone|name|address|token|cookie|card|authorization|ip/i.test(key)) {
        out[key] = redacted;
        continue;
      }
      out[key] = scrubUnknown(item, depth + 1);
    }
    return out;
  }
  return redacted;
}

export function scrubSentryEvent<T extends ReportEvent>(event: T): T {
  const next: T = { ...event };
  if (typeof next.message === "string") next.message = scrubText(next.message);
  if (next.exception?.values) {
    next.exception = {
      ...next.exception,
      values: next.exception.values.map((item) => ({
        ...item,
        value: item.value ? scrubText(item.value) : item.value,
      })),
    };
  }
  const browser = browserName(headerText(next.request?.headers, "user-agent"));
  if (next.request) {
    next.request = {
      ...next.request,
      url: next.request.url ? pageUrl(scrubText(next.request.url)) : next.request.url,
      cookies: undefined,
      headers: undefined,
      data: undefined,
      query_string: undefined,
    };
  }
  if (next.user) {
    const id = next.user.id ? maskId(next.user.id) : undefined;
    next.user = id ? { id } : undefined;
  }
  if (next.extra) next.extra = scrubUnknown(next.extra, 0) as Record<string, unknown>;
  if (next.contexts) next.contexts = scrubUnknown(next.contexts, 0) as Record<string, unknown>;
  if (next.breadcrumbs) {
    next.breadcrumbs = next.breadcrumbs.map((crumb) => ({
      ...crumb,
      message: crumb.message ? scrubText(crumb.message) : crumb.message,
      data: crumb.data ? (scrubUnknown(crumb.data, 0) as Record<string, unknown>) : crumb.data,
    }));
  }
  const tags = { ...(next.tags ?? {}) };
  for (const [key, value] of Object.entries(tags)) {
    if (typeof value === "string") tags[key] = scrubText(value);
  }
  if (browser) tags.browser = browser;
  next.tags = tags;
  return next;
}
