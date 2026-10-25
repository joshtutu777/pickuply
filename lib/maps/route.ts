import "server-only";
import { roundHalfMile, straightMiles } from "./miles";

export type TripMeasure = {
  miles: number | null;
  source: "driving" | "straight" | null;
  line: [number, number][];
};

type Point = { lat: number; lng: number };

/**
 * Driving miles when OpenRouteService is configured.
 * Otherwise a labeled straight line. Never presented as exact driving miles.
 */
export async function measureTrip(from: Point | null, to: Point | null): Promise<TripMeasure> {
  if (!from || !to) return { miles: null, source: null, line: [] };
  const straight = roundHalfMile(straightMiles(from, to));
  const key = process.env.OPENROUTESERVICE_API_KEY;
  if (!key) {
    return { miles: straight, source: "straight", line: [[from.lng, from.lat], [to.lng, to.lat]] };
  }
  try {
    const response = await fetch("https://api.openrouteservice.org/v2/directions/driving-car", {
      method: "POST",
      headers: {
        Authorization: key,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ coordinates: [[from.lng, from.lat], [to.lng, to.lat]] }),
    });
    if (!response.ok) throw new Error("routing unavailable");
    const body = (await response.json()) as {
      routes?: { summary?: { distance?: number }; geometry?: { coordinates?: [number, number][] } }[];
    };
    const route = body.routes?.[0];
    const meters = route?.summary?.distance;
    if (meters == null) throw new Error("routing unavailable");
    const driving = roundHalfMile(meters / 1609.344);
    if (driving < straight || driving > straight * 3) throw new Error("routing out of range");
    const line = route?.geometry?.coordinates ?? [[from.lng, from.lat], [to.lng, to.lat]];
    return { miles: driving, source: "driving", line };
  } catch {
    return { miles: straight, source: "straight", line: [[from.lng, from.lat], [to.lng, to.lat]] };
  }
}
