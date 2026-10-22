"use client";

import { useState } from "react";
import { signOutAction } from "@/lib/auth/actions";
import { createClient } from "@/lib/supabase/client";

const buttonClass =
  "inline-flex min-h-12 items-center justify-center rounded-full border border-line bg-paper-raised px-4 text-base font-semibold text-ink transition-colors hover:border-brand disabled:opacity-60";

export function SignOutButton() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function onClick() {
    if (pending) return;
    setPending(true);
    setError("");
    try {
      await signOutAction();
    } catch {
      setPending(false);
      setError("We couldn't sign you out. Try again.");
      return;
    }
    try {
      const supabase = createClient();
      await supabase.auth.signOut();
    } catch {
      // The server action already cleared the session cookies.
    }
    window.location.assign(new URL("/", window.location.origin).href);
  }

  return (
    <>
      <button type="button" onClick={onClick} disabled={pending} className={buttonClass}>
        Sign out
      </button>
      {error ? (
        <p role="alert" className="col-span-2 text-sm font-medium text-danger">
          {error}
        </p>
      ) : null}
    </>
  );
}
