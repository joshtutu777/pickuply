"use client";

import { useState, type FormEvent } from "react";
import { saveProfileEmail } from "@/app/profile/actions";
import { TextField } from "@/components/request/fields";
import { profileEmailError } from "@/lib/validation/email";

export function ProfileEmailForm({ email }: { email: string | null }) {
  const [saved, setSaved] = useState(email ?? "");
  const [value, setValue] = useState(email ?? "");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const problem = profileEmailError(value);
    setError(problem);
    setNotice(null);
    if (problem) return;
    setPending(true);
    const result = await saveProfileEmail(value);
    setPending(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    if (!value.trim()) {
      setValue(saved);
      setNotice(saved ? "Your saved email was left as is." : "Email is optional.");
      return;
    }
    const trimmed = value.trim();
    setSaved(trimmed);
    setValue(trimmed);
    setNotice("Email saved.");
  }

  return (
    <form onSubmit={onSubmit} className="mt-6 space-y-3">
      <TextField
        label="Email address"
        name="profileEmail"
        type="email"
        inputMode="email"
        autoComplete="email"
        optional
        hint="For booking updates and receipts."
        value={value}
        error={error ?? undefined}
        onChange={setValue}
      />
      {notice ? <p className="text-base text-ink">{notice}</p> : null}
      <button
        type="submit"
        disabled={pending}
        className="inline-flex min-h-12 items-center justify-center rounded-full bg-brand px-5 text-base font-semibold text-white disabled:opacity-60"
      >
        {pending ? "Saving…" : "Save email"}
      </button>
    </form>
  );
}
