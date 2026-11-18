import { connection } from "next/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { LoadingMain } from "@/components/loading-main";
import { installedAppDestination } from "@/lib/auth/access";
import { readMode } from "@/lib/auth/mode-cookie";
import { getOptionalSession, stateFromSession } from "@/lib/auth/session";

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
  // Session loading calls Date.now(). That must happen on the request,
  // or the installed app prerender fails and drivers never reach their jobs.
  await connection();
  const params = await searchParams;
  const next = typeof params.next === "string" ? params.next : null;
  const [session, mode] = await Promise.all([getOptionalSession(), readMode()]);
  redirect(installedAppDestination({ state: stateFromSession(session), next, mode }));
  return null;
}
