"use client";

import { useState } from "react";
import type { PlaceSuggestion } from "@/app/api/places/suggest/route";

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

  async function search(next: string) {
    setQuery(next);
    if (next.trim().length < 3) {
      setSuggestions([]);
      return;
    }
    const response = await fetch(`/api/places/suggest?q=${encodeURIComponent(next.trim())}`);
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
            <li key={`${suggestion.zip}-${suggestion.label}`}>
              <button
                type="button"
                className="min-h-12 w-full px-4 text-left text-base hover:bg-brand-soft"
                onClick={() => {
                  onPick(suggestion);
                  setQuery(suggestion.label);
                  setSuggestions([]);
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

  async function search(next: string) {
    setQuery(next);
    if (next.trim().length < 3) {
      setSuggestions([]);
      return;
    }
    const response = await fetch(`/api/places/suggest?q=${encodeURIComponent(next.trim())}`);
    if (!response.ok) {
      setSuggestions([]);
      return;
    }
    const body = (await response.json()) as { suggestions?: PlaceSuggestion[] };
    setSuggestions(body.suggestions ?? []);
  }

  function choose(suggestion: PlaceSuggestion) {
    const hasStreet = suggestion.line1.trim().length > 0;
    onChange({
      ...value,
      line1: hasStreet ? suggestion.line1 : value.line1,
      city: suggestion.city,
      zip: suggestion.zip,
      lat: hasStreet ? suggestion.lat : null,
      lng: hasStreet ? suggestion.lng : null,
      verified: hasStreet,
    });
    setQuery(suggestion.label);
    setSuggestions([]);
    setNote(hasStreet ? null : "Pick a street, or use the address you typed.");
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
            <li key={`${suggestion.zip}-${suggestion.label}`}>
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
          setNote("We'll use this address anyway. An admin will see that it was not verified.");
        }}
      >
        Use this address anyway
      </button>
      {note ? <p className="text-sm text-muted">{note}</p> : null}
      {value.verified ? <p className="text-sm text-muted">Address matched.</p> : null}
    </fieldset>
  );
}
