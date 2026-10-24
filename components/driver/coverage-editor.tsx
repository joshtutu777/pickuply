"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { CoverageDraft } from "@/lib/driver/coverage";

const controlClass =
  "mt-2 min-h-12 w-full rounded-2xl border border-line bg-paper-raised px-4 text-base text-ink";

export function CoverageEditor({
  value,
  onChange,
  persist = false,
}: {
  value: CoverageDraft;
  onChange: (next: CoverageDraft) => void;
  persist?: boolean;
}) {
  const [draft, setDraft] = useState(value);
  const [cities, setCities] = useState<string[] | null>(null);
  const [zip, setZip] = useState("");
  const [originZip, setOriginZip] = useState(value.radiusZip);
  const [fromZip, setFromZip] = useState(Boolean(value.radiusZip));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    void supabase
      .from("ga_zip_centroids")
      .select("city")
      .limit(2000)
      .then(({ data, error: loadError }) => {
        if (loadError) {
          setCities([]);
          setError("Cities could not be loaded. Refresh and try again.");
          return;
        }
        const names = [...new Set((data ?? []).map((row) => row.city))].sort((a, b) => a.localeCompare(b));
        setCities(names);
      });
  }, []);

  async function commit(next: CoverageDraft) {
    setError(null);
    setSaved(null);
    if (next.cities.length === 0 && next.zips.length === 0 && next.radius == null) {
      setError("Choose at least one area you cover.");
      return;
    }
    if (!persist) {
      setDraft(next);
      onChange(next);
      return;
    }
    const { error: saveError } = await createClient().rpc("save_driver_coverage", {
      cities: next.cities,
      zips: next.zips,
      radius: next.radius,
      radius_from_zip: next.radius && next.radiusZip ? next.radiusZip : null,
    });
    if (saveError) {
      setError(saveError.message);
      return;
    }
    setDraft(next);
    onChange(next);
    setSaved("Saved");
  }

  function addZip() {
    const next = zip.trim();
    if (!/^[0-9]{5}$/.test(next)) {
      setError("Enter a Georgia ZIP code.");
      return;
    }
    if (draft.zips.includes(next)) return;
    void commit({ ...draft, zips: [...draft.zips, next] });
    setZip("");
  }

  return (
    <div className="space-y-3">
      <p className="text-base text-ink">Choose cities, ZIP codes, or a radius. A job matches if the pickup is in any of them.</p>
      <div>
        <label className="block text-base font-semibold text-ink" htmlFor="coverage-city">
          Georgia city
          <select
            id="coverage-city"
            value=""
            onChange={(event) => {
              const match = event.target.value;
              if (!match || draft.cities.includes(match)) return;
              void commit({ ...draft, cities: [...draft.cities, match] });
            }}
            className={controlClass}
          >
            <option value="">
              {cities === null ? "Loading cities…" : cities.length === 0 ? "No cities found" : "Choose a city"}
            </option>
            {(cities ?? [])
              .filter((name) => !draft.cities.includes(name))
              .map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
          </select>
        </label>
      </div>
      {draft.cities.length > 0 ? (
        <ul className="flex flex-wrap gap-2">
          {draft.cities.map((name) => (
            <li key={name}>
              <button
                type="button"
                onClick={() => void commit({ ...draft, cities: draft.cities.filter((item) => item !== name) })}
                className="inline-flex min-h-12 items-center rounded-full bg-paper px-4 ring-1 ring-line"
              >
                {name} · Remove
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div>
        <label className="block text-base font-semibold text-ink" htmlFor="coverage-zip">
          Georgia ZIP
          <input
            id="coverage-zip"
            value={zip}
            inputMode="numeric"
            onChange={(event) => setZip(event.target.value)}
            className={controlClass}
          />
        </label>
        <button type="button" onClick={addZip} className="mt-2 inline-flex min-h-12 items-center font-semibold text-brand">
          Add ZIP
        </button>
      </div>
      {draft.zips.length > 0 ? (
        <ul className="flex flex-wrap gap-2">
          {draft.zips.map((code) => (
            <li key={code}>
              <button
                type="button"
                onClick={() => void commit({ ...draft, zips: draft.zips.filter((item) => item !== code) })}
                className="inline-flex min-h-12 items-center rounded-full bg-paper px-4 ring-1 ring-line"
              >
                {code} · Remove
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <label className="block text-base font-semibold text-ink" htmlFor="coverage-radius">
        Radius
        <select
          id="coverage-radius"
          value={draft.radius ?? ""}
          onChange={(event) => {
            const next = event.target.value ? Number(event.target.value) : null;
            void commit({ ...draft, radius: next, radiusZip: next ? draft.radiusZip : "" });
          }}
          className={controlClass}
        >
          <option value="">No radius</option>
          <option value="10">10 miles</option>
          <option value="25">25 miles</option>
          <option value="50">50 miles</option>
          <option value="100">100 miles</option>
        </select>
      </label>
      {draft.radius ? (
        <div className="space-y-2">
          <label className="flex min-h-12 items-center gap-3 text-base">
            <input
              type="radio"
              name="radius-from"
              checked={!fromZip}
              onChange={() => {
                setFromZip(false);
                void commit({ ...draft, radiusZip: "" });
              }}
            />
            From my home
          </label>
          <label className="flex min-h-12 items-center gap-3 text-base">
            <input
              type="radio"
              name="radius-from"
              checked={fromZip}
              onChange={() => setFromZip(true)}
            />
            From a Georgia ZIP
          </label>
          {fromZip ? (
            <label className="block text-base font-semibold text-ink" htmlFor="radius-zip">
              Radius ZIP
              <input
                id="radius-zip"
                value={originZip}
                inputMode="numeric"
                onChange={(event) => setOriginZip(event.target.value)}
                onBlur={() => void commit({ ...draft, radiusZip: originZip.trim() })}
                className={controlClass}
              />
            </label>
          ) : null}
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="text-base text-danger">
          {error}
        </p>
      ) : null}
      {saved ? (
        <p role="status" className="text-base text-ink">
          {saved}
        </p>
      ) : null}
    </div>
  );
}
