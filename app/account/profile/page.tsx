import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { SignOutButton } from "@/components/sign-out-button";
import { LoadingMain } from "@/components/loading-main";
import { requireSignedIn } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "Profile",
};

export default function ProfilePage() {
  return (
    <Suspense fallback={<LoadingMain />}>
      <ProfileContent />
    </Suspense>
  );
}

async function ProfileContent() {
  const session = await requireSignedIn("/account/profile");
  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-4 py-8">
      <p className="text-sm font-semibold tracking-wide text-brand uppercase">Profile</p>
      <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight text-ink">
        {session.fullName ?? "Your profile"}
      </h1>
      <p className="mt-2 text-base text-muted">Customer account</p>
      <ul className="mt-6 grid gap-3">
        <li>
          <Link href="/account/notifications" className="flex min-h-12 items-center rounded-3xl bg-paper-raised px-4 font-semibold text-ink ring-1 ring-line">
            Alerts
          </Link>
        </li>
        <li>
          <Link href="/support" className="flex min-h-12 items-center rounded-3xl bg-paper-raised px-4 font-semibold text-ink ring-1 ring-line">
            Contact support
          </Link>
        </li>
        <li>
          <Link href="/terms" className="flex min-h-12 items-center rounded-3xl bg-paper-raised px-4 font-semibold text-ink ring-1 ring-line">
            Terms
          </Link>
        </li>
      </ul>
      <div className="mt-6">
        <SignOutButton />
      </div>
    </main>
  );
}
