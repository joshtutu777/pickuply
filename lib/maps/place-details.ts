import "server-only";

import { addressFromComponents } from "@/lib/maps/address";

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
