export type CheckoutLine = {
  quantity: number;
  price_data: {
    currency: "usd";
    unit_amount: number;
    product_data: { name: string };
  };
};

function line(name: string, amountCents: number): CheckoutLine {
  return {
    quantity: 1,
    price_data: {
      currency: "usd",
      unit_amount: amountCents,
      product_data: { name },
    },
  };
}

/**
 * The charged total is the stored customer total. Card processing is its own
 * line when that stored fee is already part of the total. A mismatch keeps one
 * line for the stored total so an older row is not repriced.
 */
/** Stripe Checkout receives an email only when the profile already has one. */
export function checkoutCustomerEmail(email: string | null | undefined): string | undefined {
  const trimmed = (email ?? "").trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function checkoutLines(amountCents: number, offerCents: number, processingCents: number): CheckoutLine[] {
  if (offerCents > 0 && processingCents > 0 && offerCents + processingCents === amountCents) {
    return [line("Pickuply offer", offerCents), line("Card processing fee", processingCents)];
  }
  return [line("Pickuply job", amountCents)];
}
