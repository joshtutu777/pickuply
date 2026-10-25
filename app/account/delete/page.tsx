import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { cancelDeletion, requestDeletion } from "@/app/account/delete/actions";
import { BackLink } from "@/components/back-link";
import { LoadingMain } from "@/components/loading-main";
import { deletionGraceOpen } from "@/lib/account/restriction";
import { singleQuery } from "@/lib/auth/query";
import { requireSignedIn } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Delete account",
};

type DeletePageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default function DeleteAccountPage({ searchParams }: DeletePageProps) {
  return (
    <Suspense fallback={<LoadingMain />}>
      <DeleteContent searchParams={searchParams} />
    </Suspense>
  );
}

async function DeleteContent({ searchParams }: DeletePageProps) {
  const session = await requireSignedIn("/account/delete");
  const params = await searchParams;
  const saved = singleQuery(params.saved);
  const error = singleQuery(params.error);
  const supabase = await createClient();
  const { data: openRequest } = await supabase
    .from("account_deletion_requests")
    .select("status, grace_ends_at")
    .eq("profile_id", session.userId)
    .in("status", ["pending", "deferred"])
    .order("requested_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const waiting = saved === "pending" || openRequest?.status === "pending" || openRequest?.status === "deferred";
  const graceOpen = deletionGraceOpen(openRequest?.status, openRequest?.grace_ends_at);

  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-4 py-8">
      <BackLink href={session.role === "driver" ? "/driver/profile" : "/account/profile"} label="Profile" />
      <p className="text-sm font-semibold tracking-wide text-brand uppercase">Account management</p>
      <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight text-ink">Delete Account</h1>
      <div className="mt-4 space-y-3 text-base text-ink">
        <p>Deletion is permanent once it is completed. Personal information is removed or anonymized.</p>
        <p>Payment, payout, and dispute records that the business still needs are kept.</p>
        <p>After you ask, you have 14 days to cancel. Confirm your phone to cancel.</p>
        <p>When those 14 days end, Pickuply deletes the account if nothing else is still open. An active job, a payment hold, a capture, a refund, a payout, a dispute, or money owed keeps the request pending. Those 14 days do not start over.</p>
      </div>
      {saved === "completed" ? (
        <p role="status" className="mt-6 text-base font-semibold text-ink">
          This account is deleted. Sign-in for it no longer works.
        </p>
      ) : null}
      {saved === "cancelled" ? (
        <p role="status" className="mt-6 text-base font-semibold text-ink">
          The deletion request is cancelled. This account stays open.
        </p>
      ) : null}
      {waiting && saved !== "completed" ? (
        <p role="status" className="mt-6 text-base font-semibold text-ink">
          Your deletion request is pending. You can cancel it during the 14 days. After that, Pickuply finishes it when the account has no open jobs or money still in motion.
        </p>
      ) : null}
      {graceOpen ? (
        <form action={cancelDeletion} className="mt-4">
          <button type="submit" className="inline-flex min-h-12 items-center justify-center rounded-full bg-ink px-6 text-base font-semibold text-white">
            Cancel deletion request
          </button>
        </form>
      ) : null}
      {error === "confirm" ? (
        <p role="alert" className="mt-4 text-base font-medium text-danger">
          Check the box and type DELETE to continue.
        </p>
      ) : null}
      {error === "phone" ? (
        <p role="alert" className="mt-4 text-base font-medium text-danger">
          Confirm your phone again, then come back to this page.{" "}
          <Link href="/login?next=/account/delete" className="font-semibold text-brand">
            Confirm phone
          </Link>
        </p>
      ) : null}
      {error === "cancel" ? (
        <p role="alert" className="mt-4 text-base font-medium text-danger">
          This deletion request cannot be cancelled.
        </p>
      ) : null}
      {error === "1" ? (
        <p role="alert" className="mt-4 text-base font-medium text-danger">
          The deletion request could not be saved. Try again.
        </p>
      ) : null}
      {saved === "completed" || waiting ? null : (
        <form action={requestDeletion} className="mt-8 space-y-4">
          <label className="flex min-h-12 items-start gap-3 text-base text-ink">
            <input type="checkbox" name="confirm" className="mt-1" />
            I understand deletion is permanent once it is completed.
          </label>
          <label className="block text-base font-semibold text-ink" htmlFor="phrase">
            Type DELETE to confirm
            <input
              id="phrase"
              name="phrase"
              required
              autoComplete="off"
              className="mt-2 min-h-12 w-full rounded-2xl border border-line bg-paper px-4 text-base"
            />
          </label>
          <button
            type="submit"
            className="inline-flex min-h-12 items-center justify-center rounded-full bg-danger px-6 text-base font-semibold text-white"
          >
            Delete Account
          </button>
        </form>
      )}
    </main>
  );
}
