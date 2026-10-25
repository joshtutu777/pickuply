"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function acceptDriverTerms() {
  const supabase = await createClient();
  const { error } = await supabase.rpc("accept_driver_terms");
  if (error) redirect(`/driver?error=${encodeURIComponent(error.message)}`);
  redirect("/driver?saved=terms");
}

export async function dismissOnlinePrompt() {
  const jar = await cookies();
  jar.set("pickuply.online-prompt", "dismissed", {
    path: "/",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 365,
  });
  redirect("/driver");
}
