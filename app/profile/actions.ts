"use server";

import { redirect } from "next/navigation";
import { writeMode } from "@/lib/auth/mode-cookie";
import { getOptionalSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

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
