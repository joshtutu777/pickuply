"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { saveProfileNames } from "@/app/profile/actions";
import { TextField } from "@/components/request/fields";

export function ProfileNameForm({ firstName, lastName }: { firstName: string; lastName: string }) {
  const router = useRouter();
  const [given, setGiven] = useState(firstName);
  const [family, setFamily] = useState(lastName);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setPending(true);
    const result = await saveProfileNames(given, family);
    setPending(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setNotice("Name saved.");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="mt-6 space-y-3">
      <TextField
        label="First name"
        name="firstName"
        autoComplete="given-name"
        required
        maxLength={40}
        value={given}
        error={error ?? undefined}
        onChange={setGiven}
      />
      <TextField
        label="Last name"
        name="lastName"
        autoComplete="family-name"
        required
        maxLength={40}
        value={family}
        onChange={setFamily}
      />
      {notice ? <p className="text-base text-ink">{notice}</p> : null}
      <button
        type="submit"
        disabled={pending}
        className="inline-flex min-h-12 items-center justify-center rounded-full bg-brand px-5 text-base font-semibold text-white disabled:opacity-60"
      >
        {pending ? "Saving…" : "Save name"}
      </button>
    </form>
  );
}
