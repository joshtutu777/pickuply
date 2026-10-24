import { NextResponse } from "next/server";
import { placeDetails } from "@/app/api/places/suggest/route";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const supabase = await createClient();
  const url = new URL(request.url);
  const id = url.searchParams.get("id")?.trim() ?? "";
  const session = url.searchParams.get("session")?.trim() ?? "";
  if (!id || !session) return NextResponse.json({ place: null });
  const place = await placeDetails(id, session);
  if (!place) return NextResponse.json({ place: null });
  const known = await supabase.from("ga_zip_centroids").select("zip, city").eq("zip", place.zip).maybeSingle();
  if (!known.data) {
    return NextResponse.json({
      place: { ...place, city: place.city, lat: null, lng: null, verified: false },
    });
  }
  return NextResponse.json({
    place: { ...place, city: known.data.city || place.city, verified: Boolean(place.line1 && place.lat != null) },
  });
}
