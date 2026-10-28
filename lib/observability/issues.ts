const slugPattern = /^[A-Za-z0-9_-]+$/;

export function sentrySlug(value: string | undefined): string {
  const text = value?.trim() ?? "";
  return slugPattern.test(text) ? text : "";
}

export function issuesHref(org: string): string {
  return `https://sentry.io/organizations/${encodeURIComponent(org)}/issues/?query=is%3Aunresolved`;
}

export function parseHits(header: string | null): number | null {
  if (!header || !/^\d+$/.test(header)) return null;
  return Number(header);
}

export function issueCountLabel(count: number): string {
  return count === 1 ? "1 unresolved error" : `${count} unresolved errors`;
}
