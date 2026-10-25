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

/**
 * Card is the only Checkout method. Stripe no longer accepts a static
 * payment_method_types list, and it rejects allowed and excluded together.
 * Link is a wallet, so it is hidden separately. Card itself is not excluded.
 */
export const checkoutExcludedPaymentMethods = [
  "acss_debit",
  "affirm",
  "afterpay_clearpay",
  "alipay",
  "alma",
  "amazon_pay",
  "au_becs_debit",
  "bacs_debit",
  "bancontact",
  "billie",
  "bizum",
  "blik",
  "boleto",
  "cashapp",
  "crypto",
  "customer_balance",
  "eps",
  "fpx",
  "giropay",
  "grabpay",
  "ideal",
  "kakao_pay",
  "klarna",
  "konbini",
  "kr_card",
  "mb_way",
  "mobilepay",
  "multibanco",
  "naver_pay",
  "nz_bank_account",
  "oxxo",
  "p24",
  "pay_by_bank",
  "payco",
  "paynow",
  "paypal",
  "paypay",
  "payto",
  "pix",
  "promptpay",
  "revolut_pay",
  "samsung_pay",
  "satispay",
  "scalapay",
  "sepa_debit",
  "sequra",
  "sofort",
  "sunbit",
  "swish",
  "twint",
  "upi",
  "us_bank_account",
  "wechat_pay",
  "zip",
] as const;

export function checkoutLines(amountCents: number, offerCents: number, processingCents: number): CheckoutLine[] {
  if (offerCents > 0 && processingCents > 0 && offerCents + processingCents === amountCents) {
    return [line("Pickuply offer", offerCents), line("Card processing fee", processingCents)];
  }
  return [line("Pickuply job", amountCents)];
}
