import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Driver Terms",
};

export default function DriverTermsPage() {
  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-4 py-8">
      <p className="text-sm font-semibold tracking-wide text-brand uppercase">Driver</p>
      <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight text-ink">Driver Terms</h1>
      <p className="mt-4 text-base leading-relaxed text-ink">
        Version driver-terms-v1. A driver accepts these terms by checking the box on the application. Pickuply does not check that box.
      </p>
      <p className="mt-4 text-base leading-relaxed text-ink">
        The Terms of Service and Privacy Policy also apply.
      </p>
      <p className="mt-4 flex flex-wrap gap-4">
        <Link href="/terms" className="inline-flex min-h-12 items-center font-semibold text-brand">
          Terms of Service
        </Link>
        <Link href="/privacy" className="inline-flex min-h-12 items-center font-semibold text-brand">
          Privacy Policy
        </Link>
      </p>
    </main>
  );
}
