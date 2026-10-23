/** Nearest half mile. 12.2 becomes 12, 12.3 becomes 12.5. */
export function roundHalfMile(miles: number): number {
  return Math.round(miles * 2) / 2;
}

export function straightMiles(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
): number {
  const earth = 3958.8;
  const lat1 = (from.lat * Math.PI) / 180;
  const lat2 = (to.lat * Math.PI) / 180;
  const dLat = ((to.lat - from.lat) * Math.PI) / 180;
  const dLng = ((to.lng - from.lng) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return earth * 2 * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function tripLabel(miles: number | null, source: string | null): string {
  if (miles == null || !source) return "—";
  const rounded = roundHalfMile(Number(miles));
  if (source === "driving") return `${rounded} driving miles`;
  return `${rounded} straight-line miles`;
}
