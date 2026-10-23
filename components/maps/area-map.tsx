"use client";

import { useEffect, useRef, useState } from "react";
import "maplibre-gl/dist/maplibre-gl.css";

type Circle = { lat: number; lng: number; label: string };
type Pin = { lat: number; lng: number; label: string };

function ring(lat: number, lng: number, miles = 1): [number, number][] {
  const earth = 3958.8;
  const lat1 = (lat * Math.PI) / 180;
  const lng1 = (lng * Math.PI) / 180;
  const angular = miles / earth;
  const points: [number, number][] = [];
  for (let step = 0; step <= 32; step += 1) {
    const bearing = (step / 32) * 2 * Math.PI;
    const lat2 = Math.asin(
      Math.sin(lat1) * Math.cos(angular) + Math.cos(lat1) * Math.sin(angular) * Math.cos(bearing),
    );
    const lng2 =
      lng1 +
      Math.atan2(
        Math.sin(bearing) * Math.sin(angular) * Math.cos(lat1),
        Math.cos(angular) - Math.sin(lat1) * Math.sin(lat2),
      );
    points.push([(lng2 * 180) / Math.PI, (lat2 * 180) / Math.PI]);
  }
  return points;
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
  const key = process.env.NEXT_PUBLIC_MAPTILER_KEY;
  const holder = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const circleKey = circles.map((circle) => circle.label).join("|");
  const pinKey = pins.map((pin) => pin.label).join("|");

  useEffect(() => {
    if (!key || !holder.current) return;
    let map: { remove: () => void } | null = null;
    let cancelled = false;
    void import("maplibre-gl")
      .then((maplibre) => {
        if (cancelled || !holder.current) return;
        const created = new maplibre.Map({
          container: holder.current,
          style: `https://api.maptiler.com/maps/streets-v2/style.json?key=${key}`,
          center: pins[0] ? [pins[0].lng, pins[0].lat] : circles[0] ? [circles[0].lng, circles[0].lat] : [-83.5, 32.7],
          zoom: pins.length > 0 ? 11 : 8,
        });
        map = created;
        created.on("load", () => {
          if (circles.length > 0) {
            created.addSource("areas", {
              type: "geojson",
              data: {
                type: "FeatureCollection",
                features: circles.map((circle) => ({
                  type: "Feature" as const,
                  properties: { label: circle.label },
                  geometry: { type: "Polygon" as const, coordinates: [ring(circle.lat, circle.lng)] },
                })),
              },
            });
            created.addLayer({
              id: "areas",
              type: "fill",
              source: "areas",
              paint: { "fill-color": "#0f6e56", "fill-opacity": 0.25 },
            });
          }
          if (line.length > 1) {
            created.addSource("route", {
              type: "geojson",
              data: {
                type: "Feature",
                properties: {},
                geometry: { type: "LineString", coordinates: line },
              },
            });
            created.addLayer({
              id: "route",
              type: "line",
              source: "route",
              paint: { "line-color": "#0f6e56", "line-width": 4 },
            });
          }
          for (const pin of pins) {
            new maplibre.Marker({ color: "#0f6e56" }).setLngLat([pin.lng, pin.lat]).addTo(created);
          }
        });
        created.on("error", () => setFailed(true));
      })
      .catch(() => setFailed(true));
    return () => {
      cancelled = true;
      map?.remove();
    };
  }, [circleKey, circles, key, line, pinKey, pins]);

  if (!key || failed) return <Fallback circles={circles} pins={pins} caption={caption} />;

  return (
    <section aria-label={caption}>
      <p className="mb-2 text-base font-semibold text-ink">{caption}</p>
      <div ref={holder} className="h-64 w-full overflow-hidden rounded-3xl" />
    </section>
  );
}
