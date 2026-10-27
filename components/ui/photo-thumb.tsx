"use client";

import { useEffect, useId, useRef, useState } from "react";

export function PhotoThumb({ src, alt }: { src: string; alt: string }) {
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (failed) {
    return <p className="max-w-48 text-base text-muted">This photo could not be loaded. Refresh the page for a new link.</p>;
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="block rounded-2xl" aria-label={`View ${alt}`}>
        {/* Signed URL. It expires and is not a public file address. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={alt} className="h-24 w-24 rounded-2xl object-cover" onError={() => setFailed(true)} />
      </button>
      {open ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/80 p-4"
          onClick={() => setOpen(false)}
        >
          <div className="grid max-h-[90dvh] max-w-full gap-3" onClick={(event) => event.stopPropagation()}>
            <p id={titleId} className="text-base font-semibold text-white">
              {alt}
            </p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src} alt={alt} className="max-h-[75dvh] max-w-full object-contain" onError={() => setFailed(true)} />
            <button
              ref={closeRef}
              type="button"
              onClick={() => setOpen(false)}
              className="inline-flex min-h-12 items-center justify-center rounded-full bg-white px-4 font-semibold text-ink"
            >
              Close
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
