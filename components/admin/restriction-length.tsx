"use client";

import { useState } from "react";

export function RestrictionLength({ id }: { id: string }) {
  const [kind, setKind] = useState("indefinite");
  return (
    <>
      <label className="block text-base font-semibold text-ink" htmlFor={id}>
        Restriction
        <select
          id={id}
          name="kind"
          value={kind}
          onChange={(event) => setKind(event.target.value)}
          className="mt-2 min-h-12 w-full rounded-2xl border border-line bg-paper px-4"
        >
          <option value="indefinite">No end date</option>
          <option value="hours-24">24 hours</option>
          <option value="days-3">3 days</option>
          <option value="days-7">7 days</option>
          <option value="days-30">30 days</option>
          <option value="custom">Custom date</option>
        </select>
      </label>
      {kind === "custom" ? (
        <label className="block text-base font-semibold text-ink" htmlFor={`${id}-until`}>
          Ends (Eastern)
          <input
            id={`${id}-until`}
            name="expiresAt"
            type="datetime-local"
            required
            className="mt-2 min-h-12 w-full rounded-2xl border border-line bg-paper px-4"
          />
        </label>
      ) : null}
    </>
  );
}
