"use client";

import { useEffect, useState } from "react";
import { AreaMap } from "@/components/maps/area-map";
import { createClient } from "@/lib/supabase/client";

function zipOf(area: string): string | null {
  return area.match(/[0-9]{5}/)?.[0] ?? null;
}

export function FeedMap({ jobs }: { jobs: { id: string; pickup_area: string }[] }) {
  const [circles, setCircles] = useState<{ lat: number; lng: number; label: string }[]>([]);

  const zips = [...new Set(jobs.map((job) => zipOf(job.pickup_area)).filter((zip): zip is string => Boolean(zip)))];
  const zipKey = zips.join(",");

  useEffect(() => {
    if (!zipKey) return;
    let cancelled = false;
    void createClient()
      .from("ga_zip_centroids")
      .select("zip, city, lat, lng")
      .in("zip", zipKey.split(","))
      .then(({ data }) => {
        if (cancelled) return;
        setCircles(
          (data ?? []).map((row) => {
            const job = jobs.find((item) => zipOf(item.pickup_area) === row.zip);
            return {
              lat: row.lat,
              lng: row.lng,
              label: `${row.city} ${row.zip}`,
              href: job ? `/driver/jobs/${job.id}` : undefined,
            };
          }),
        );
      });
    return () => {
      cancelled = true;
    };
  }, [jobs, zipKey]);

  return <AreaMap circles={zipKey ? circles : []} caption="Jobs near these pickup areas" />;
}
