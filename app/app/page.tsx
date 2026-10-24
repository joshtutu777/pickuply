import { redirect } from "next/navigation";
import { readMode } from "@/lib/auth/mode-cookie";
import { createClient } from "@/lib/supabase/server";

export default async function InstalledAppStart({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const next = typeof params.next === "string" && params.next.startsWith("/") && !params.next.startsWith("//") ? params.next : null;
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect(next ? `/login?next=${encodeURIComponent(next)}` : "/");
  if (next) redirect(next);
  const [{ data: profile }, mode] = await Promise.all([
    supabase.from("profiles").select("role").eq("id", data.user.id).maybeSingle(),
    readMode(),
  ]);
  if (profile?.role === "admin") redirect("/admin");
  if (profile?.role === "driver" || mode === "driver") redirect("/driver");
  redirect("/account");
}
