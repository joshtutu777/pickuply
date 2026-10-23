export type PlaceSuggestion = {
  label: string;
  line1: string;
  city: string;
  zip: string;
  lat: number | null;
  lng: number | null;
  placeId?: string;
};

export type AddressParts = {
  line1: string;
  city: string;
  zip: string;
  state: string;
  lat: number | null;
  lng: number | null;
};

type Component = { types?: string[]; longText?: string; shortText?: string };

export function componentText(components: Component[], type: string, short = false): string {
  const match = components.find((item) => item.types?.includes(type));
  if (!match) return "";
  return (short ? match.shortText : match.longText) ?? "";
}

/** Turns a Google address into street, city, and ZIP. Coordinates stay empty when the state is not Georgia. */
export function addressFromComponents(
  components: Component[],
  location?: { latitude?: number; longitude?: number },
): AddressParts | null {
  const number = componentText(components, "street_number");
  const route = componentText(components, "route");
  const line1 = [number, route].filter(Boolean).join(" ");
  const city =
    componentText(components, "locality") ||
    componentText(components, "postal_town") ||
    componentText(components, "sublocality") ||
    componentText(components, "administrative_area_level_3");
  const zip = componentText(components, "postal_code").slice(0, 5);
  const state = componentText(components, "administrative_area_level_1", true);
  if (state && state !== "GA") return null;
  if (!/^\d{5}$/.test(zip)) return null;
  return {
    line1,
    city,
    zip,
    state: "GA",
    lat: location?.latitude ?? null,
    lng: location?.longitude ?? null,
  };
}

export function manualAddressError(place: { line1: string; city: string; zip: string }): string | null {
  if (!place.line1.trim()) return "Enter the street address.";
  if (!place.city.trim()) return "Enter the city.";
  if (!/^\d{5}$/.test(place.zip.trim())) return "Enter a 5-digit Georgia ZIP code.";
  return null;
}
