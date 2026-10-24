import type { Metadata } from "next";
import { Suspense } from "react";
import { BackLink } from "@/components/back-link";
import { FeedbackForm } from "@/components/feedback-form";
import { LoadingMain } from "@/components/loading-main";
import { appVersion, betaMessage } from "@/lib/beta";
import { safePagePath } from "@/lib/feedback";
import { requireSignedIn } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Send Feedback" };

export default function FeedbackPage({ searchParams }: PageProps<"/feedback">) {
  return (
    <Suspense fallback={<LoadingMain />}>
      <FeedbackContent searchParams={searchParams} />
    </Suspense>
  );
}

async function FeedbackContent({ searchParams }: { searchParams: PageProps<"/feedback">["searchParams"] }) {
  await requireSignedIn("/feedback");
  const query = await searchParams;
  const from = safePagePath(typeof query.from === "string" ? query.from : "/feedback");
  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-4 py-8">
      <BackLink href={from === "/feedback" ? "/account" : from} label="Back" />
      <p className="text-sm font-semibold tracking-wide text-brand uppercase">Beta</p>
      <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight text-ink">Send Feedback</h1>
      <p className="mt-3 text-base leading-relaxed text-muted">{betaMessage}</p>
      <FeedbackForm pagePath={from} appVersion={appVersion()} />
    </main>
  );
}
