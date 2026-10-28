import type { Metadata } from "next";
import { Suspense } from "react";
import { removeSavedCard } from "@/app/jobs/tip-actions";
import { BackLink } from "@/components/back-link";
import { LoadingMain } from "@/components/loading-main";
import { requireSignedIn } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Payment methods",
};

export default function PaymentsPage() {
  return (
    <Suspense fallback={<LoadingMain />}>
      <SavedCards />
    </Suspense>
  );
}

async function SavedCards() {
  const session = await requireSignedIn("/account/payments");
  const supabase = await createClient();
  const { data } = await supabase
    .from("customer_payment_methods")
    .select("stripe_payment_method_id, brand, last4")
    .eq("customer_id", session.userId)
    .is("detached_at", null);
  const cards = data ?? [];
  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-4 py-8">
      <BackLink href="/account" label="Account" />
      <h1 className="mt-3 font-display text-4xl font-semibold text-ink">Payment methods</h1>
      <p className="mt-3 text-base text-muted">
        A saved card can be used for a tip you confirm. Removing a card stops one-tap tipping for future jobs. Pickuply does not store the card number.
      </p>
      {cards.length === 0 ? <p className="mt-4">No saved card.</p> : null}
      <ul className="mt-4 grid gap-3">
        {cards.map((card) => (
          <li key={card.stripe_payment_method_id} className="rounded-3xl bg-paper-raised p-4 ring-1 ring-line">
            <p>{card.brand ?? "Card"} ending {card.last4 ?? "••••"}</p>
            <form action={removeSavedCard} className="mt-3">
              <input type="hidden" name="paymentMethod" value={card.stripe_payment_method_id} />
              <button type="submit" className="min-h-12 font-semibold text-brand">Remove card</button>
            </form>
          </li>
        ))}
      </ul>
    </main>
  );
}
