"use client";

import { useActionState } from "react";
import { saveFullName, type NameFormState } from "@/lib/auth/actions";

const initialState: NameFormState = { error: "" };

const inputClass =
  "mt-2 min-h-12 w-full rounded-2xl border border-line bg-paper-raised px-4 text-base text-ink";

const primaryButton =
  "inline-flex min-h-12 items-center justify-center rounded-full bg-brand px-6 text-base font-semibold text-white transition-colors hover:bg-brand-dark disabled:opacity-60";

export function NameForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(saveFullName, initialState);
  return (
    <form action={action} className="mt-8 flex flex-col gap-4">
      <input type="hidden" name="next" value={next} />
      <label className="block" htmlFor="fullName">
        <span className="text-base font-semibold text-ink">Full name</span>
        <input
          id="fullName"
          name="fullName"
          type="text"
          required
          minLength={1}
          maxLength={80}
          autoComplete="name"
          aria-invalid={state.error ? true : undefined}
          aria-describedby={state.error ? "fullName-error" : undefined}
          className={inputClass}
        />
      </label>
      {state.error ? (
        <p id="fullName-error" role="alert" className="text-sm font-medium text-danger">
          {state.error}
        </p>
      ) : null}
      <button type="submit" className={primaryButton} disabled={pending}>
        {pending ? "Saving" : "Continue"}
      </button>
    </form>
  );
}
