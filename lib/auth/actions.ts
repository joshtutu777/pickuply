"use server";

import { connection } from "next/server";
import { redirect } from "next/navigation";
import { continueDestination, isRole } from "@/lib/auth/access";
import { validateFullName } from "@/lib/auth/name";
import { safeReturnPath } from "@/lib/auth/safe-return-path";
import { createClient } from "@/lib/supabase/server";

export type NameFormState = { error: string };

export async function saveFullName(
  _previous: NameFormState,
  formData: FormData,
): Promise<NameFormState> {
  await connection();
  const name = validateFullName(String(formData.get("fullName") ?? ""));
  const next = safeReturnPath(String(formData.get("next") ?? ""));
  if (!name) {
    return {
      error: "Enter your full name using letters, spaces, apostrophes, periods, or hyphens.",
    };
  }

  let supabase: Awaited<ReturnType<typeof createClient>>;
  try {
    supabase = await createClient();
  } catch {
    return { error: "Sign-in is not available right now." };
  }

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    const destination = next ? `/login?${new URLSearchParams({ next }).toString()}` : "/login";
    redirect(destination);
  }

  // Only the name column. The role trigger blocks a person from promoting themselves.
  const { data, error } = await supabase
    .from("profiles")
    .update({ full_name: name })
    .eq("id", userData.user.id)
    .select("role, full_name")
    .maybeSingle();

  if (error || !data || typeof data.role !== "string" || !isRole(data.role)) {
    return { error: "We couldn't save your name. Try again." };
  }
  if (typeof data.full_name !== "string" || data.full_name.trim().length === 0) {
    return { error: "We couldn't save your name. Try again." };
  }

  redirect(continueDestination(data.role, next));
}

/** Clears the server session cookies, then the browser clears its own copy. */
export async function signOutAction(): Promise<void> {
  await connection();
  try {
    const supabase = await createClient();
    await supabase.auth.signOut();
  } catch {
    // The browser sign-out still runs. Missing settings must not trap the click.
  }
}
