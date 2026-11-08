"use client";

import { useEffect } from "react";

export default function JobError({ error, reset }: { error: Error; reset: () => void }) {
  useEffect(() => {
    console.error(error.message);
  }, [error]);

  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-4 py-10">
      <h1 className="font-display text-4xl font-semibold text-ink">We couldn&apos;t load this request</h1>
      <p className="mt-4 text-lg text-muted">Your request is still saved. Try opening it again.</p>
      <button
        type="button"
        onClick={() => reset()}
        className="mt-6 inline-flex min-h-12 items-center font-semibold text-brand"
      >
        Try again
      </button>
    </main>
  );
}
