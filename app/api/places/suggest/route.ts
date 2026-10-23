import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export type PlaceSuggestion = {
  label: string;
  line1: string;
  city: string;
  zip: string;
  lat: number;
  lng: number;
};

const georgiaBox = "-85.6052,30.3556,-80.8408,35.0008";

export async function GET(request: Request) {
  const supabase = await createClient();
  const user = await supabase.auth.getUser();
  if (!user.data.user) {
    return NextResponse.json({ suggestions: [] }, { status: 401 });
  }
  const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (query.length < 3) return NextResponse.json({ suggestions: [] });

  const key = process.env.NEXT_PUBLIC_MAPTILER_KEY;
  if (key) {
    try {
      const url = `https://api.maptiler.com/geocoding/${encodeURIComponent(query)}.json?key=${encodeURIComponent(key)}&country=us&bbox=${georgiaBox}&limit=5`;
      const response = await fetch(url);
      if (response.ok) {
        const body = (await response.json()) as {
          features?: {
            text?: string;
            place_name?: string;
            center?: [number, number];
            context?: { id?: string; text?: string }[];
          }[];
        };
        const suggestions: PlaceSuggestion[] = [];
        for (const feature of body.features ?? []) {
          const context = feature.context ?? [];
          const zip = context.find((item) => item.id?.startsWith("postal"))?.text ?? "";
          const city = context.find((item) => item.id?.startsWith("place") || item.id?.startsWith("locality"))?.text ?? "";
          const region = context.find((item) => item.id?.startsWith("region"))?.text ?? "";
          if (!/^\d{5}$/.test(zip) || !city || (region && region !== "Georgia")) continue;
          const known = await supabase.from("ga_zip_centroids").select("zip").eq("zip", zip).maybeSingle();
          if (!known.data || !feature.center) continue;
          suggestions.push({
            label: feature.place_name ?? `${feature.text}, ${city}, ${zip}`,
            line1: feature.text ?? "",
            city,
            zip,
            lng: feature.center[0],
            lat: feature.center[1],
          });
        }
        if (suggestions.length > 0) return NextResponse.json({ suggestions });
      }
    } catch {
      // Fall through to city and ZIP matches.
    }
  }

  const safe = query.replace(/[^a-zA-Z0-9 ]/g, "").slice(0, 40);
  const { data } = /^\d/.test(safe)
    ? await supabase.from("ga_zip_centroids").select("city, zip, lat, lng").like("zip", `${safe}%`).limit(8)
    : await supabase.from("ga_zip_centroids").select("city, zip, lat, lng").ilike("city", `${safe}%`).limit(8);
  const suggestions: PlaceSuggestion[] = (data ?? []).map((row) => ({
    label: `${row.city}, ${row.zip}`,
    line1: "",
    city: row.city,
    zip: row.zip,
    lat: row.lat,
    lng: row.lng,
  }));
  return NextResponse.json({ suggestions });
}
