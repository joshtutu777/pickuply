import "server-only";
import { issuesHref, parseHits, sentrySlug } from "./issues";

export type IssueSummary =
  | { state: "unconfigured"; href: string | null }
  | { state: "ready"; count: number; href: string }
  | { state: "unavailable"; href: string | null };

/** Unresolved Sentry issues for the admin health page. The token stays on the server. */
export async function loadIssueSummary(): Promise<IssueSummary> {
  const org = sentrySlug(process.env.SENTRY_ORG);
  const project = sentrySlug(process.env.SENTRY_PROJECT);
  const token = process.env.SENTRY_AUTH_TOKEN?.trim() ?? "";
  const href = org ? issuesHref(org) : null;
  if (!org || !project || !token) return { state: "unconfigured", href };
  try {
    const response = await fetch(
      `https://sentry.io/api/0/projects/${encodeURIComponent(org)}/${encodeURIComponent(project)}/issues/?query=is%3Aunresolved&limit=1`,
      {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
        signal: AbortSignal.timeout(4000),
      },
    );
    if (!response.ok) return { state: "unavailable", href };
    const count = parseHits(response.headers.get("x-hits"));
    if (count == null || !href) return { state: "unavailable", href };
    return { state: "ready", count, href };
  } catch {
    return { state: "unavailable", href };
  }
}
