"use client";

import { useEffect, useRef, useState } from "react";

type Circle = { lat: number; lng: number; label: string; href?: string };
type Pin = { lat: number; lng: number; label: string };
type Overlay = { setMap: (map: GoogleMap | null) => void };

type GoogleMap = {
  fitBounds: (bounds: GoogleBounds, padding?: number) => void;
  setCenter: (point: { lat: number; lng: number }) => void;
  setZoom: (zoom: number) => void;
};

type GoogleBounds = {
  extend: (point: { lat: number; lng: number }) => void;
  isEmpty: () => boolean;
};

type GoogleMaps = {
  Map: new (element: HTMLElement, options: object) => GoogleMap;
  Marker: new (options: object) => Overlay;
  Circle: new (options: object) => Overlay & { addListener: (event: string, handler: () => void) => void };
  Polyline: new (options: object) => Overlay;
  LatLngBounds: new () => GoogleBounds;
};

declare global {
  interface Window {
    google?: { maps?: GoogleMaps };
  }
}

let loader: Promise<GoogleMaps> | null = null;

function loadMaps(key: string): Promise<GoogleMaps> {
  if (window.google?.maps) return Promise.resolve(window.google.maps);
  if (loader) return loader;
  loader = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly`;
    script.async = true;
    script.onload = () => {
      if (window.google?.maps) resolve(window.google.maps);
      else reject(new Error("Google Maps did not load"));
    };
    script.onerror = () => {
      loader = null;
      reject(new Error("Google Maps did not load"));
    };
    document.head.appendChild(script);
  });
  return loader;
}

function Fallback({
  circles,
  pins,
  caption,
}: {
  circles: Circle[];
  pins: Pin[];
  caption: string;
}) {
  return (
    <section className="rounded-3xl bg-brand-soft px-4 py-5 ring-1 ring-brand/15" aria-label={caption}>
      <p className="text-base font-semibold text-ink">{caption}</p>
      <ul className="mt-2 space-y-1 text-base text-ink">
        {circles.map((circle) => (
          <li key={circle.label}>{circle.label}</li>
        ))}
        {pins.map((pin) => (
          <li key={pin.label}>{pin.label}</li>
        ))}
        {circles.length === 0 && pins.length === 0 ? <li>No map points yet.</li> : null}
      </ul>
    </section>
  );
}

const pickupColor = "#0f6e56";

export function AreaMap({
  circles = [],
  pins = [],
  line = [],
  caption,
}: {
  circles?: Circle[];
  pins?: Pin[];
  line?: [number, number][];
  caption: string;
}) {
  const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  const holder = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);
  const circleKey = circles.map((circle) => `${circle.lat},${circle.lng}:${circle.label}:${circle.href ?? ""}`).join("|");
  const pinKey = pins.map((pin) => `${pin.lat},${pin.lng}:${pin.label}`).join("|");
  const lineKey = line.map((point) => point.join(",")).join("|");
  const dataRef = useRef({ circles, pins, line });
  useEffect(() => {
    dataRef.current = { circles, pins, line };
  }, [circles, pins, line]);

  useEffect(() => {
    if (!key || !holder.current) return;
    const node = holder.current;
    let cancelled = false;
    let map: GoogleMap | null = null;
    const overlays: Overlay[] = [];
    void loadMaps(key)
      .then((maps) => {
        if (cancelled || !holder.current) return;
        const { circles: areas, pins: markers, line: route } = dataRef.current;
        const first = markers[0] ?? areas[0];
        map = new maps.Map(holder.current, {
          center: first ? { lat: first.lat, lng: first.lng } : { lat: 32.7, lng: -83.5 },
          zoom: 12,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
          zoomControl: true,
          clickableIcons: false,
          gestureHandling: "auto",
        });
        const bounds = new maps.LatLngBounds();
        for (const area of areas) {
          const circle = new maps.Circle({
            map,
            center: { lat: area.lat, lng: area.lng },
            radius: 1609,
            strokeColor: pickupColor,
            strokeOpacity: 0.8,
            strokeWeight: 1,
            fillColor: pickupColor,
            fillOpacity: 0.25,
            clickable: Boolean(area.href),
          });
          if (area.href) {
            const href = area.href;
            circle.addListener("click", () => {
              window.location.assign(href);
            });
          }
          overlays.push(circle);
          bounds.extend({ lat: area.lat, lng: area.lng });
          const latPad = 1609 / 111320;
          const lngPad = 1609 / (111320 * Math.cos((area.lat * Math.PI) / 180));
          bounds.extend({ lat: area.lat + latPad, lng: area.lng + lngPad });
          bounds.extend({ lat: area.lat - latPad, lng: area.lng - lngPad });
        }
        if (route.length > 1) {
          overlays.push(
            new maps.Polyline({
              map,
              path: route.map(([lng, lat]) => ({ lat, lng })),
              strokeColor: pickupColor,
              strokeOpacity: 0.9,
              strokeWeight: 4,
              clickable: false,
            }),
          );
          for (const [lng, lat] of route) bounds.extend({ lat, lng });
        }
        for (const pin of markers) {
          overlays.push(
            new maps.Marker({
              map,
              position: { lat: pin.lat, lng: pin.lng },
              title: pin.label,
              label: pin.label === "Drop-off" ? "D" : pin.label === "Pickup" ? "P" : undefined,
            }),
          );
          bounds.extend({ lat: pin.lat, lng: pin.lng });
        }
        if (!bounds.isEmpty()) {
          if (markers.length + areas.length > 1 || route.length > 1 || areas.length === 1) map.fitBounds(bounds, 48);
          else if (first) {
            map.setCenter({ lat: first.lat, lng: first.lng });
            map.setZoom(14);
          }
        }
        if (!cancelled) setReady(true);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      for (const overlay of overlays) overlay.setMap(null);
      node.replaceChildren();
    };
  }, [circleKey, key, lineKey, pinKey]);

  if (!key || failed) return <Fallback circles={circles} pins={pins} caption={caption} />;

  return (
    <section aria-label={caption}>
      <p className="mb-2 text-base font-semibold text-ink">{caption}</p>
      {ready ? null : <p className="mb-2 text-base text-muted">Loading map…</p>}
      <div ref={holder} className="h-64 w-full overflow-hidden rounded-3xl bg-paper-raised" />
    </section>
  );
}

export function TripPreview({
  pickup,
  dropoff,
}: {
  pickup: { lat: number | null; lng: number | null; verified: boolean; text: string } | null;
  dropoff: { lat: number | null; lng: number | null; verified: boolean; text: string } | null;
}) {
  const pins: Pin[] = [];
  if (pickup?.verified && pickup.lat != null && pickup.lng != null) {
    pins.push({ lat: pickup.lat, lng: pickup.lng, label: "Pickup" });
  }
  if (dropoff?.verified && dropoff.lat != null && dropoff.lng != null) {
    pins.push({ lat: dropoff.lat, lng: dropoff.lng, label: "Drop-off" });
  }
  const unverified = [pickup, dropoff].filter((place) => place && place.text && !place.verified);

  return (
    <div className="grid gap-2">
      {pins.length > 0 ? (
        <AreaMap
          caption={pins.length > 1 ? "Pickup and drop-off" : pins[0]?.label === "Drop-off" ? "Drop-off" : "Pickup"}
          pins={pins}
        />
      ) : (
        <p className="text-base text-ink">Location not verified. A matched address places the pin. A typed address does not invent one.</p>
      )}
      {unverified.map((place) => (
        <p key={place?.text} className="text-base text-ink">
          Address not verified: {place?.text}
        </p>
      ))}
    </div>
  );
}
