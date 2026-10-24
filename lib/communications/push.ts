const privatePattern = /(\+?1?\d{10})|@[a-z0-9.-]+\.[a-z]{2,}|\$\d|suspension reason|investigation/i;

export type PushPayload = {
  title: string;
  body: string;
  href: string;
  id: string;
};

export function pushPayload(input: PushPayload): PushPayload | null {
  const title = input.title.trim();
  const body = input.body.trim();
  const href = input.href.trim();
  if (!title || !body || !input.id) return null;
  if (!href.startsWith("/") || href.startsWith("//")) return null;
  if (privatePattern.test(`${title} ${body} ${href}`)) return null;
  return { title: title.slice(0, 120), body: body.slice(0, 400), href, id: input.id };
}

export function pushTargets(subscriptions: { expired: boolean }[], permissionGranted: boolean): number {
  if (!permissionGranted) return 0;
  return subscriptions.filter((subscription) => !subscription.expired).length;
}
