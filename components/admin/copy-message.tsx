"use client";

import { useState } from "react";

export function CopyMessage({ message }: { message: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <section className="mt-6">
      <h2 className="text-lg font-semibold text-ink">Message to copy</h2>
      <p className="mt-1 text-sm text-muted">Nothing is texted from here. Copy this and send it yourself.</p>
      <textarea
        readOnly
        className="mt-3 min-h-28 w-full rounded-2xl border border-line bg-paper-raised px-4 py-3 text-base"
        value={message}
      />
      <button
        type="button"
        className="mt-3 inline-flex min-h-12 items-center justify-center rounded-full bg-ink px-5 font-semibold text-white"
        onClick={async () => {
          await navigator.clipboard.writeText(message);
          setCopied(true);
        }}
      >
        {copied ? "Copied" : "Copy message"}
      </button>
    </section>
  );
}
