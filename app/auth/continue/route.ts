import { connection } from "next/server";
import { redirect } from "next/navigation";
import { authLocation, safeIntent, safeNextParam } from "@/lib/auth/access";
import { preferredHome } from "@/lib/auth/mode";
import { readMode } from "@/lib/auth/mode-cookie";
import { getOptionalSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  await connection();
  const url = new URL(request.url);
  const next = safeNextParam(url.searchParams.get("next"));
  const intent = safeIntent(url.searchParams.get("intent"));
  const session = await getOptionalSession();

  if (!session) {
    redirect(authLocation("/login", next, intent));
  }
  if (!session.role) redirect("/login?error=profile");
  if (!session.fullName?.trim()) {
    redirect(authLocation("/login/name", next, intent));
  }
  const mode = await readMode();
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
      hasDriver = false;
    }
  }
  redirect(preferredHome({ role: session.role, mode, hasDriver, next, intent }));
}
