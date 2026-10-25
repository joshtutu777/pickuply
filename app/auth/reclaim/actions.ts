"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function keepPhoneAccount() {
  const supabase = await createClient();
  const { error } = await supabase.rpc("confirm_phone_owner");
  if (error) redirect("/auth/reclaim?error=1");
  redirect("/auth/continue");
}

export async function startFreshAccount() {
  const supabase = await createClient();
  const { error } = await supabase.rpc("decline_phone_owner");
  if (error) redirect("/auth/reclaim?error=1");
  await supabase.auth.signOut();
  redirect("/login?reclaim=1");
}
