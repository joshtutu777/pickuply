export function freshRequestHref(service?: string | null): string {
  const params = new URLSearchParams();
  params.set("new", crypto.randomUUID());
  if (service) params.set("service", service);
  return `/request?${params.toString()}`;
}
