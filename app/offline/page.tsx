import type { Metadata } from "next";

export const metadata: Metadata = { title: "Offline" };

export default function OfflinePage() {
  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-4 py-8">
      <h1 className="font-display text-4xl font-semibold text-ink">You are offline</h1>
      <p className="mt-4 text-base text-ink">
        Pickuply needs a connection to book a pickup, pay, or update a job. Open the app again when you are back online.
      </p>
    </main>
  );
}
