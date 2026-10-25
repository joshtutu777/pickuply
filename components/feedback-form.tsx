"use client";

import { useActionState, useRef } from "react";
import { submitFeedback, type FeedbackState } from "@/app/feedback/actions";
import { feedbackTypes } from "@/lib/feedback";

const initial: FeedbackState = { error: "", done: false };

export function FeedbackForm({ pagePath, appVersion }: { pagePath: string; appVersion: string }) {
  const [state, action, pending] = useActionState(submitFeedback, initial);
  const deviceRef = useRef<HTMLInputElement>(null);

  if (state.done) {
    return (
      <p role="status" className="mt-6 rounded-3xl bg-brand-soft px-4 py-4 text-base leading-relaxed text-ink">
        Thanks for helping us improve Pickuply. We&apos;ve received your feedback.
      </p>
    );
  }

  return (
    <form
      action={action}
      className="mt-6 grid gap-4"
      onSubmit={() => {
        if (deviceRef.current) deviceRef.current.value = window.navigator.userAgent.slice(0, 160);
      }}
    >
      <input type="hidden" name="page" value={pagePath} />
      <input ref={deviceRef} type="hidden" name="device" defaultValue="" />
      <input type="hidden" name="version" value={appVersion} />
      <label className="grid gap-2 text-base font-semibold text-ink">
        Feedback type
        <select name="type" required defaultValue="" className="min-h-12 rounded-2xl bg-paper-raised px-3 font-normal ring-1 ring-line">
          <option value="" disabled>
            Choose one
          </option>
          {feedbackTypes.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-2 text-base font-semibold text-ink">
        Subject
        <input
          name="subject"
          required
          minLength={3}
          maxLength={120}
          className="min-h-12 rounded-2xl bg-paper-raised px-3 font-normal ring-1 ring-line"
        />
      </label>
      <label className="grid gap-2 text-base font-semibold text-ink">
        Details
        <textarea
          name="details"
          required
          minLength={10}
          maxLength={4000}
          rows={6}
          className="rounded-2xl bg-paper-raised px-3 py-3 font-normal ring-1 ring-line"
        />
      </label>
      <p className="text-sm text-muted">Screenshots are not collected in this version.</p>
      {state.error ? (
        <p role="alert" className="text-base font-medium text-danger">
          {state.error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="inline-flex min-h-12 items-center justify-center rounded-full bg-brand px-5 text-base font-semibold text-white disabled:opacity-60"
      >
        {pending ? "Sending…" : "Submit Feedback"}
      </button>
    </form>
  );
}
