"use client";

import { useEffect, useRef, useState } from "react";
import { termsEffective, termsSections } from "@/lib/legal/terms";

export function TermsDialog() {
  const [open, setOpen] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const pushed = useRef(false);

  useEffect(() => {
    function onPop() {
      pushed.current = false;
      setOpen(false);
    }
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  function openTerms() {
    setOpen(true);
    history.pushState({ pickuplyTerms: true }, "");
    pushed.current = true;
  }

  function closeTerms() {
    if (pushed.current) {
      history.back();
      return;
    }
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        if (pushed.current) history.back();
        else setOpen(false);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <>
      <button type="button" className="font-semibold text-brand underline" onClick={openTerms}>
        Terms, fees, and prohibited items
      </button>
      {open ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 sm:items-center" role="presentation">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="request-terms-title"
            className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-t-3xl bg-paper sm:rounded-3xl"
          >
            <div className="flex flex-col gap-3 border-b border-line px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <h2 id="request-terms-title" className="font-display text-2xl font-semibold text-ink">
                Terms of Service
              </h2>
              <button
                ref={closeRef}
                type="button"
                className="inline-flex min-h-12 items-center justify-center rounded-full bg-brand px-4 font-semibold text-white"
                onClick={closeTerms}
              >
                Back to your request
              </button>
            </div>
            <div className="overflow-y-auto px-4 py-4">
              <p className="text-base text-muted">Effective date: {termsEffective}</p>
              <div className="mt-6 grid gap-8">
                {termsSections.map((section, index) => (
                  <section key={section.id}>
                    <h3 className="font-display text-xl font-semibold text-ink">
                      {index + 1}. {section.heading}
                    </h3>
                    {section.paragraphs.map((paragraph, paragraphIndex) => (
                      <p key={paragraphIndex} className="mt-3 text-base leading-relaxed text-ink">
                        {paragraph}
                      </p>
                    ))}
                  </section>
                ))}
              </div>
              <button
                type="button"
                className="mt-8 inline-flex min-h-12 items-center font-semibold text-brand"
                onClick={closeTerms}
              >
                Back to your request
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
