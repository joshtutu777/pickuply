import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { LoginForm } from "@/app/login/login-form";
import { LoadingMain } from "@/components/loading-main";
import { authLocation, decideAccess, safeIntent, safeNextParam } from "@/lib/auth/access";
import { singleQuery } from "@/lib/auth/query";
import { getOptionalSession, stateFromSession } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "Log in",
};

const notices: Record<string, string> = {
  profile: "We couldn't open your profile. Try signing in again.",
};

export default function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[]; error?: string | string[]; intent?: string | string[] }>;
}) {
  return (
    <Suspense fallback={<LoadingMain />}>
      <LoginContent searchParams={searchParams} />
    </Suspense>
  );
}

async function LoginContent({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[]; error?: string | string[]; intent?: string | string[] }>;
}) {
  const params = await searchParams;
  const next = safeNextParam(singleQuery(params.next));
  const intent = safeIntent(singleQuery(params.intent));
  const located = authLocation("/login", next, intent);
  const search = located.startsWith("/login?") ? located.slice("/login".length) : "";
  const session = await getOptionalSession();
  const decision = decideAccess({
    pathname: "/login",
    search,
    state: stateFromSession(session),
  });
  if (decision.type === "redirect") redirect(decision.location);

  const errorCode = singleQuery(params.error) ?? "";
  const notice = notices[errorCode] ?? "";
  return <LoginForm next={next ?? ""} intent={intent ?? ""} notice={notice} />;
}
