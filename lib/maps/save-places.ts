"use server";

import { measureTrip } from "@/lib/maps/route";
import { createClient } from "@/lib/supabase/server";

type JobPlaces = {
  pickupUnit: string;
  dropoffUnit: string;
  pickupLat: number | null;
  pickupLng: number | null;
  dropoffLat: number | null;
  dropoffLng: number | null;
  pickupVerified: boolean;
  dropoffVerified: boolean;
};

/** Stores private coordinates, then trip miles. A failure leaves the request saved and the distance blank. */
export async function saveJobPlaces(jobId: string, places: JobPlaces): Promise<void> {
  const supabase = await createClient();
  const saved = await supabase.rpc("save_job_places", {
    job_id: jobId,
    payload: {
      pickup_unit: places.pickupUnit,
      dropoff_unit: places.dropoffUnit,
      pickup_lat: places.pickupLat,
      pickup_lng: places.pickupLng,
      dropoff_lat: places.dropoffLat,
      dropoff_lng: places.dropoffLng,
      pickup_verified: places.pickupVerified ? "true" : "false",
      dropoff_verified: places.dropoffVerified ? "true" : "false",
    },
  });
  if (saved.error) return;
  const from =
    places.pickupVerified && places.pickupLat != null && places.pickupLng != null
      ? { lat: places.pickupLat, lng: places.pickupLng }
      : null;
  const to =
    places.dropoffVerified && places.dropoffLat != null && places.dropoffLng != null
      ? { lat: places.dropoffLat, lng: places.dropoffLng }
      : null;
  const trip = await measureTrip(from, to);
  await supabase.rpc("set_job_trip_miles", {
    job_id: jobId,
    miles: trip.miles,
    source: trip.source,
  });
}

export async function saveDriverPlace(place: {
  line1: string;
  unit: string;
  city: string;
  zip: string;
  lat: number | null;
  lng: number | null;
  verified: boolean;
  notes: string;
}): Promise<string | null> {
  const supabase = await createClient();
  const saved = await supabase.rpc("save_driver_place", {
    payload: {
      line1: place.line1,
      unit: place.unit,
      city: place.city,
      zip: place.zip,
      lat: place.lat,
      lng: place.lng,
      verified: place.verified ? "true" : "false",
      notes: place.notes,
    },
  });
  return saved.error?.message ?? null;
}

export async function saveCustomerPlace(place: {
  id?: string;
  label: string;
  line1: string;
  unit: string;
  city: string;
  zip: string;
  lat: number | null;
  lng: number | null;
  verified: boolean;
  notes: string;
}): Promise<string | null> {
  const supabase = await createClient();
  const saved = await supabase.rpc("save_customer_place", {
    payload: {
      id: place.id ?? null,
      label: place.label,
      line1: place.line1,
      unit: place.unit,
      city: place.city,
      zip: place.zip,
      lat: place.lat,
      lng: place.lng,
      verified: place.verified ? "true" : "false",
      notes: place.notes,
    },
  });
  return saved.error?.message ?? null;
}
