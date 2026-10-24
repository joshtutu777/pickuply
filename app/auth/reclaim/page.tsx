import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { keepPhoneAccount, startFreshAccount } from "@/app/auth/reclaim/actions";
import { LoadingMain } from "@/components/loading-main";
import { requireSignedIn } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Is this your account?" };

type ReclaimPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default function ReclaimPage({ searchParams }: ReclaimPageProps) {
  return (
    <Suspense fallback={<LoadingMain />}>
      <Reclaim searchParams={searchParams} />
    </Suspense>
  );
}

async function Reclaim({ searchParams }: ReclaimPageProps) {
  await requireSignedIn("/auth/reclaim");
  const params = await searchParams;
  const supabase = await createClient();
  const { data } = await supabase.rpc("phone_reclaim_hint");
  const hint = data && typeof data === "object" ? (data as { initial?: string; city?: string; month?: string; blocked?: boolean }) : null;
  if (!hint) redirect("/auth/continue");
  if (hint.blocked) {
    await supabase.auth.signOut();
    redirect("/login?reclaim=review");
  }

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center px-5 py-14">
      <p className="text-sm font-semibold tracking-wide text-brand uppercase">Account</p>
      <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight text-ink">Is this your account?</h1>
      <p className="mt-4 text-lg text-ink">
        {hint.initial}. Last pickup: {hint.city}, {hint.month}.
      </p>
      {params.error ? <p role="alert" className="mt-4 text-base text-danger">That choice could not be saved.</p> : null}
      <form action={keepPhoneAccount} className="mt-6">
        <button type="submit" className="inline-flex min-h-12 items-center justify-center rounded-full bg-brand px-6 font-semibold text-white">
          Yes
        </button>
      </form>
      <form action={startFreshAccount} className="mt-3">
        <button type="submit" className="inline-flex min-h-12 items-center font-semibold text-ink">
          No, start a new account
        </button>
      </form>
    </main>
  );
}
