import type { Metadata } from "next";
import { Suspense } from "react";
import { NameForm } from "@/app/login/name/name-form";
import { LoadingMain } from "@/components/loading-main";
import { authLocation, safeIntent, safeNextParam } from "@/lib/auth/access";
import { singleQuery } from "@/lib/auth/query";
import { requireSignedIn } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "Your name",
};

export default function NamePage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[]; intent?: string | string[] }>;
}) {
  return (
    <Suspense fallback={<LoadingMain />}>
      <NameContent searchParams={searchParams} />
    </Suspense>
  );
}

async function NameContent({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[]; intent?: string | string[] }>;
}) {
  const params = await searchParams;
  const next = safeNextParam(singleQuery(params.next));
  const intent = safeIntent(singleQuery(params.intent));
  const located = authLocation("/login/name", next, intent);
  const signedInSearch = located.startsWith("/login/name?") ? located.slice("/login/name".length) : "";
  await requireSignedIn("/login/name", signedInSearch);

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center px-5 py-14">
      <p className="text-sm font-semibold tracking-wide text-brand uppercase">Account</p>
      <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight text-ink">
        Your name
      </h1>
      <p className="mt-4 text-lg leading-relaxed text-muted">
        Enter your first name. We&apos;ll ask again the next time you sign in until it is saved.
      </p>
      <NameForm next={next ?? ""} intent={intent ?? ""} />
    </main>
  );
}
