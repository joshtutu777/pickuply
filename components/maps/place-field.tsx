"use client";

import { useState } from "react";
import type { PlaceSuggestion } from "@/lib/maps/address";

export type PlaceValue = {
  line1: string;
  unit: string;
  city: string;
  zip: string;
  lat: number | null;
  lng: number | null;
  verified: boolean;
  notes: string;
};

export function emptyPlace(): PlaceValue {
  return { line1: "", unit: "", city: "", zip: "", lat: null, lng: null, verified: false, notes: "" };
}

export function AddressLookup({
  label,
  onPick,
}: {
  label: string;
  onPick: (suggestion: PlaceSuggestion) => void;
}) {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [session] = useState(() => crypto.randomUUID());

  async function search(next: string) {
    setQuery(next);
    if (next.trim().length < 3) {
      setSuggestions([]);
      return;
    }
    const response = await fetch(`/api/places/suggest?q=${encodeURIComponent(next.trim())}&session=${session}`);
    if (!response.ok) {
      setSuggestions([]);
      return;
    }
    const body = (await response.json()) as { suggestions?: PlaceSuggestion[] };
    setSuggestions(body.suggestions ?? []);
  }

  return (
    <div>
      <label className="block text-base font-semibold text-ink">
        {label}
        <input
          value={query}
          onChange={(event) => void search(event.target.value)}
          className="mt-2 min-h-12 w-full rounded-2xl border border-line px-4"
          autoComplete="off"
        />
      </label>
      {suggestions.length > 0 ? (
        <ul className="mt-2 overflow-hidden rounded-2xl ring-1 ring-line">
          {suggestions.map((suggestion) => (
            <li key={suggestion.placeId ?? `${suggestion.label}-${suggestion.zip}`}>
              <button
                type="button"
                className="min-h-12 w-full px-4 text-left text-base hover:bg-brand-soft"
                onClick={() => {
                  void (async () => {
                    if (!suggestion.placeId) {
                      onPick({ ...suggestion, lat: null, lng: null });
                    } else {
                      const response = await fetch(`/api/places/details?id=${encodeURIComponent(suggestion.placeId)}&session=${session}`);
                      const body = (await response.json()) as {
                        place?: PlaceSuggestion & { verified?: boolean };
                      };
                      const place = body.place;
                      onPick(
                        place
                          ? {
                              label: suggestion.label,
                              line1: place.line1,
                              city: place.city,
                              zip: place.zip,
                              lat: place.verified ? place.lat : null,
                              lng: place.verified ? place.lng : null,
                            }
                          : { ...suggestion, lat: null, lng: null },
                      );
                    }
                    setQuery(suggestion.label);
                    setSuggestions([]);
                  })();
                }}
              >
                {suggestion.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function PlaceField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: PlaceValue;
  onChange: (next: PlaceValue) => void;
}) {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [session] = useState(() => crypto.randomUUID());

  async function search(next: string) {
    setQuery(next);
    if (next.trim().length < 3) {
      setSuggestions([]);
      return;
    }
    const response = await fetch(`/api/places/suggest?q=${encodeURIComponent(next.trim())}&session=${session}`);
    if (!response.ok) {
      setSuggestions([]);
      return;
    }
    const body = (await response.json()) as { suggestions?: PlaceSuggestion[] };
    setSuggestions(body.suggestions ?? []);
  }

  async function choose(suggestion: PlaceSuggestion) {
    setSuggestions([]);
    setQuery(suggestion.label);
    if (suggestion.placeId) {
      const response = await fetch(`/api/places/details?id=${encodeURIComponent(suggestion.placeId)}&session=${session}`);
      const body = (await response.json()) as {
        place?: { line1: string; city: string; zip: string; lat: number | null; lng: number | null; verified?: boolean };
      };
      if (body.place?.line1 && body.place.zip) {
        onChange({
          ...value,
          line1: body.place.line1,
          city: body.place.city,
          zip: body.place.zip,
          lat: body.place.verified ? body.place.lat : null,
          lng: body.place.verified ? body.place.lng : null,
          verified: Boolean(body.place.verified),
        });
        setNote(body.place.verified ? null : "This match has no confirmed house location. You can still use it.");
        return;
      }
    }
    onChange({
      ...value,
      city: suggestion.city || value.city,
      zip: suggestion.zip || value.zip,
      lat: null,
      lng: null,
      verified: false,
    });
    setNote("Pick a street, or type the address below and use it anyway.");
  }

  return (
    <fieldset className="space-y-3">
      <legend className="text-base font-semibold text-ink">{label}</legend>
      <label className="block text-base font-semibold text-ink">
        Search a Georgia address
        <input
          value={query}
          onChange={(event) => void search(event.target.value)}
          className="mt-2 min-h-12 w-full rounded-2xl border border-line px-4"
          autoComplete="off"
        />
      </label>
      {suggestions.length > 0 ? (
        <ul className="overflow-hidden rounded-2xl ring-1 ring-line">
          {suggestions.map((suggestion) => (
            <li key={suggestion.placeId ?? `${suggestion.label}-${suggestion.zip}`}>
              <button
                type="button"
                className="min-h-12 w-full px-4 text-left text-base hover:bg-brand-soft"
                onClick={() => choose(suggestion)}
              >
                {suggestion.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <label className="block text-base font-semibold text-ink">
        Street
        <input
          value={value.line1}
          onChange={(event) => onChange({ ...value, line1: event.target.value, verified: false, lat: null, lng: null })}
          className="mt-2 min-h-12 w-full rounded-2xl border border-line px-4"
          autoComplete="street-address"
        />
      </label>
      <label className="block text-base font-semibold text-ink">
        Apt or unit
        <input
          value={value.unit}
          onChange={(event) => onChange({ ...value, unit: event.target.value })}
          className="mt-2 min-h-12 w-full rounded-2xl border border-line px-4"
        />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block text-base font-semibold text-ink">
          City
          <input
            value={value.city}
            onChange={(event) => onChange({ ...value, city: event.target.value, verified: false })}
            className="mt-2 min-h-12 w-full rounded-2xl border border-line px-4"
          />
        </label>
        <label className="block text-base font-semibold text-ink">
          State
          <input value="Georgia" readOnly className="mt-2 min-h-12 w-full rounded-2xl border border-line bg-paper px-4" />
        </label>
        <label className="block text-base font-semibold text-ink">
          ZIP
          <input
            value={value.zip}
            inputMode="numeric"
            onChange={(event) => onChange({ ...value, zip: event.target.value, verified: false, lat: null, lng: null })}
            className="mt-2 min-h-12 w-full rounded-2xl border border-line px-4"
          />
        </label>
      </div>
      <label className="block text-base font-semibold text-ink">
        Notes
        <input
          value={value.notes}
          onChange={(event) => onChange({ ...value, notes: event.target.value })}
          className="mt-2 min-h-12 w-full rounded-2xl border border-line px-4"
        />
      </label>
      <button
        type="button"
        className="min-h-12 text-base font-semibold text-brand"
        onClick={() => {
          onChange({ ...value, verified: false, lat: null, lng: null });
          setNote("We'll use the street, city, and ZIP you typed. An admin will see that it was not verified.");
        }}
      >
        Use this address anyway
      </button>
      {note ? <p className="text-sm text-muted">{note}</p> : null}
      {value.verified ? <p className="text-sm text-muted">Address matched.</p> : null}
    </fieldset>
  );
}
