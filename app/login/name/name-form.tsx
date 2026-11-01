"use client";

import Link from "next/link";
import { useActionState } from "react";
import { saveFullName, type NameFormState } from "@/lib/auth/actions";

const initialState: NameFormState = { error: "" };

const inputClass =
  "mt-2 min-h-12 w-full rounded-2xl border border-line bg-paper-raised px-4 text-base text-ink";

const primaryButton =
  "inline-flex min-h-12 items-center justify-center rounded-full bg-brand px-6 text-base font-semibold text-white transition-colors hover:bg-brand-dark disabled:opacity-60";

export function NameForm({
  next,
  intent,
  defaultFirst,
  defaultLast,
  savedName,
}: {
  next: string;
  intent: string;
  defaultFirst: string;
  defaultLast: string;
  savedName: string;
}) {
  const [state, action, pending] = useActionState(saveFullName, initialState);
  const saved = savedName.trim();
  const showSaved = saved.length > 0 && saved !== defaultFirst.trim();
  return (
    <form action={action} className="mt-8 flex flex-col gap-4">
      <input type="hidden" name="next" value={next} />
      <input type="hidden" name="intent" value={intent} />
      {showSaved ? (
        <p className="text-base text-ink">
          Saved name: {saved}. Enter your first and last name to finish. This stays as it is until you save.
        </p>
      ) : null}
      <label className="block" htmlFor="firstName">
        <span className="text-base font-semibold text-ink">First name</span>
        <input
          id="firstName"
          name="firstName"
          type="text"
          required
          minLength={1}
          maxLength={40}
          autoComplete="given-name"
          autoCapitalize="words"
          defaultValue={defaultFirst}
          aria-invalid={state.error ? true : undefined}
          aria-describedby={state.error ? "name-error" : undefined}
          className={inputClass}
        />
      </label>
      <label className="block" htmlFor="lastName">
        <span className="text-base font-semibold text-ink">Last name</span>
        <input
          id="lastName"
          name="lastName"
          type="text"
          required
          minLength={1}
          maxLength={40}
          autoComplete="family-name"
          autoCapitalize="words"
          defaultValue={defaultLast}
          aria-invalid={state.error ? true : undefined}
          aria-describedby={state.error ? "name-error" : undefined}
          className={inputClass}
        />
      </label>
      <label className="flex min-h-12 items-start gap-3 text-base text-ink">
        <input className="mt-1 size-5" type="checkbox" name="consent" value="yes" required />
        <span>I agree to the Terms and Privacy Policy.</span>
      </label>
      <p className="text-sm text-muted">
        <Link href="/terms" className="font-semibold text-brand">
          Terms
        </Link>
        {" · "}
        <Link href="/privacy" className="font-semibold text-brand">
          Privacy
        </Link>
      </p>
      {state.error ? (
        <p id="name-error" role="alert" className="text-sm font-medium text-danger">
          {state.error}
        </p>
      ) : null}
      <button type="submit" className={primaryButton} disabled={pending}>
        {pending ? "Saving" : "Continue"}
      </button>
    </form>
  );
}
