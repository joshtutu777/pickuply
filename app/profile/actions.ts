"use server";

import { redirect } from "next/navigation";
import { writeMode } from "@/lib/auth/mode-cookie";
import { getOptionalSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { customerEmailError, normalizeEmail, profileEmailError } from "@/lib/validation/email";

/** Saves the signed-in person's profile email. A blank value leaves the saved address in place. */
export async function saveProfileEmail(email: string): Promise<{ error: string | null }> {
  const session = await getOptionalSession();
  if (!session) return { error: "Sign in again before saving an email." };
  const normalized = normalizeEmail(email);
  const problem = normalized ? customerEmailError(normalized) : profileEmailError(email);
  if (problem) return { error: problem };
  const supabase = await createClient();
  const { error } = await supabase.rpc("save_profile_email", { next_email: normalized });
  if (error) {
    if (error.message.includes("email is not valid")) return { error: "Enter a valid email, or leave it blank." };
    return { error: "We couldn't save that email." };
  }
  return { error: null };
}

export async function switchMode(mode: "customer" | "driver"): Promise<void> {
  if (mode !== "customer" && mode !== "driver") redirect("/account");
  const session = await getOptionalSession();
  if (!session?.role) redirect("/login");
  await writeMode(mode);
  if (mode === "customer") redirect("/account");
  if (session.role === "admin") redirect("/admin");
  let hasDriver = session.role === "driver";
  if (!hasDriver) {
    try {
      const supabase = await createClient();
      const { data } = await supabase
        .from("drivers")
        .select("profile_id")
        .eq("profile_id", session.userId)
        .maybeSingle();
      hasDriver = Boolean(data);
    } catch {
      redirect("/account");
    }
  }
  redirect(hasDriver ? "/driver" : "/driver/onboarding");
}
