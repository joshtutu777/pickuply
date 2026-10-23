"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { emptyPlace, PlaceField, type PlaceValue } from "@/components/maps/place-field";
import { saveCustomerPlace, saveDriverPlace } from "@/lib/maps/save-places";

export function PlaceEditor({
  kind,
  initial,
  label = "Home",
}: {
  kind: "driver" | "customer";
  initial?: PlaceValue;
  label?: string;
}) {
  const router = useRouter();
  const [place, setPlace] = useState<PlaceValue>(initial ?? emptyPlace());
  const [name, setName] = useState(label);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const message =
      kind === "driver"
        ? await saveDriverPlace(place)
        : await saveCustomerPlace({ ...place, label: name });
    setPending(false);
    if (message) {
      setError(message);
      return;
    }
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="mt-4 space-y-3">
      {kind === "customer" ? (
        <label className="block text-base font-semibold text-ink">
          Name
          <input value={name} onChange={(event) => setName(event.target.value)} className="mt-2 min-h-12 w-full rounded-2xl border border-line px-4" />
        </label>
      ) : null}
      <PlaceField label={kind === "driver" ? "Home address" : "Saved address"} value={place} onChange={setPlace} />
      {error ? <p role="alert" className="text-base text-danger">{error}</p> : null}
      <button type="submit" disabled={pending} className="inline-flex min-h-12 items-center rounded-full bg-brand px-5 font-semibold text-white">
        Save address
      </button>
    </form>
  );
}
