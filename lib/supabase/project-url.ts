/**
 * The browser and server clients need the project origin.
 * A copied Data API address ends in /rest/v1, and auth calls would then
 * miss /auth/v1. This strips that suffix.
 */
export function supabaseProjectUrl(value: string): string {
  const url = new URL(value);
  const path = url.pathname.replace(/\/+$/, "").replace(/\/rest\/v1$/, "");
  return `${url.origin}${path}`;
}
