import { NextResponse } from "next/server";
import { addressFromComponents, type PlaceSuggestion } from "@/lib/maps/address";
import { createClient } from "@/lib/supabase/server";

const georgiaBox = {
  low: { latitude: 30.3556, longitude: -85.6052 },
  high: { latitude: 35.0008, longitude: -80.8408 },
};

async function googleSuggestions(query: string, session: string, key: string): Promise<PlaceSuggestion[] | null> {
  const response = await fetch("https://places.googleapis.com/v1/places:autocomplete", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": key,
    },
    body: JSON.stringify({
      input: query,
      sessionToken: session,
      includedRegionCodes: ["us"],
      locationRestriction: { rectangle: georgiaBox },
    }),
  });
  if (!response.ok) return null;
  const body = (await response.json()) as {
    suggestions?: { placePrediction?: { placeId?: string; text?: { text?: string } } }[];
  };
  return (body.suggestions ?? [])
    .map((item) => item.placePrediction)
    .filter((item): item is { placeId: string; text?: { text?: string } } => Boolean(item?.placeId))
    .map((item) => ({
      label: item.text?.text ?? "Georgia address",
      line1: "",
      city: "",
      zip: "",
      lat: null,
      lng: null,
      placeId: item.placeId,
    }));
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const user = await supabase.auth.getUser();
  if (!user.data.user) {
    return NextResponse.json({ suggestions: [] }, { status: 401 });
  }
  const url = new URL(request.url);
  const query = url.searchParams.get("q")?.trim() ?? "";
  const session = url.searchParams.get("session")?.trim() ?? "";
  if (query.length < 3) return NextResponse.json({ suggestions: [] });

  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (key && session) {
    try {
      const suggestions = await googleSuggestions(query, session, key);
      if (suggestions && suggestions.length > 0) return NextResponse.json({ suggestions });
    } catch {
      // City and ZIP matches still work without Google.
    }
  }

  const safe = query.replace(/[^a-zA-Z0-9 ]/g, "").slice(0, 40);
  const zip = safe.match(/\d{5}/)?.[0];
  const { data } = zip
    ? await supabase.from("ga_zip_centroids").select("city, zip").eq("zip", zip).limit(8)
    : await supabase.from("ga_zip_centroids").select("city, zip").ilike("city", `${safe.split(" ").pop()}%`).limit(8);
  const suggestions: PlaceSuggestion[] = (data ?? []).map((row) => ({
    label: `${row.city}, ${row.zip}`,
    line1: "",
    city: row.city,
    zip: row.zip,
    lat: null,
    lng: null,
  }));
  return NextResponse.json({ suggestions });
}

export async function placeDetails(placeId: string, session: string) {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) return null;
  const response = await fetch(
    `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}?sessionToken=${encodeURIComponent(session)}`,
    {
      headers: {
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": "addressComponents,location",
      },
    },
  );
  if (!response.ok) return null;
  const body = (await response.json()) as {
    addressComponents?: { types?: string[]; longText?: string; shortText?: string }[];
    location?: { latitude?: number; longitude?: number };
  };
  return addressFromComponents(body.addressComponents ?? [], body.location);
}
