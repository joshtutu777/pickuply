"use server";

import { connection } from "next/server";
import { redirect } from "next/navigation";
import { isRole, safeIntent } from "@/lib/auth/access";
import { preferredHome } from "@/lib/auth/mode";
import { readMode } from "@/lib/auth/mode-cookie";
import { validateFullName } from "@/lib/auth/name";
import { safeReturnPath } from "@/lib/auth/safe-return-path";
import { createClient } from "@/lib/supabase/server";
import { customerEmailError, normalizeEmail } from "@/lib/validation/email";

export type NameFormState = { error: string };

export async function saveFullName(
  _previous: NameFormState,
  formData: FormData,
): Promise<NameFormState> {
  await connection();
  const name = validateFullName(String(formData.get("fullName") ?? ""));
  const next = safeReturnPath(String(formData.get("next") ?? ""));
  const intent = safeIntent(String(formData.get("intent") ?? ""));
  if (formData.get("consent") !== "yes") {
    return { error: "Agree to the Terms and Privacy Policy to continue." };
  }
  if (!name) {
    return {
      error: "Enter your first name using letters, spaces, apostrophes, periods, or hyphens.",
    };
  }
  const email = normalizeEmail(String(formData.get("email") ?? ""));

  let supabase: Awaited<ReturnType<typeof createClient>>;
  try {
    supabase = await createClient();
  } catch {
    return { error: "Sign-in is not available right now." };
  }

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    const params = new URLSearchParams();
    if (next) params.set("next", next);
    if (intent) params.set("intent", intent);
    const query = params.toString();
    redirect(query ? `/login?${query}` : "/login");
  }

  const existing = await supabase.from("profiles").select("email").eq("id", userData.user.id).maybeSingle();
  const savedEmail = typeof existing.data?.email === "string" ? existing.data.email.trim() : "";
  if (intent !== "driver" && !savedEmail) {
    const emailProblem = customerEmailError(email);
    if (emailProblem) return { error: emailProblem };
    const saved = await supabase.rpc("save_profile_email", { next_email: email });
    if (saved.error) return { error: "Enter a valid email." };
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

  const mode = await readMode();
  let hasDriver = data.role === "driver";
  if (!hasDriver) {
    const { data: driver } = await supabase
      .from("drivers")
      .select("profile_id")
      .eq("profile_id", userData.user.id)
      .maybeSingle();
    hasDriver = Boolean(driver);
  }
  redirect(preferredHome({ role: data.role, mode, hasDriver, next, intent }));
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
