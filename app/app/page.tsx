import { redirect } from "next/navigation";
import { Suspense } from "react";
import { LoadingMain } from "@/components/loading-main";
import { readMode } from "@/lib/auth/mode-cookie";
import { createClient } from "@/lib/supabase/server";

type AppStartProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default function InstalledAppStart({ searchParams }: AppStartProps) {
  return (
    <Suspense fallback={<LoadingMain />}>
      <Start searchParams={searchParams} />
    </Suspense>
  );
}

async function Start({ searchParams }: AppStartProps) {
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
  return null;
}
