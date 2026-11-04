import { normalizeEmail, profileEmailError } from "@/lib/validation/email";

/** Shown when payout setup cannot start because Stripe requires a contact email. */
export const PAYOUT_EMAIL_REQUIRED = "Add your email address to your driver profile before setting up payouts.";

export type PayoutEmailSources = {
  authEmail?: string | null;
  authEmailConfirmed?: boolean | null;
  profileEmail?: string | null;
};

/**
 * Sign-in email wins when Stripe's account has confirmed it.
 * Pickuply has no separate verification step for a profile email, so a valid address
 * on this driver's own profile is the next source. Another person's address is never passed in.
 */
export function payoutContactEmail(sources: PayoutEmailSources): string | null {
  const auth = sources.authEmailConfirmed ? usableEmail(sources.authEmail) : null;
  if (auth) return auth;
  return usableEmail(sources.profileEmail);
}

function usableEmail(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const email = normalizeEmail(value);
  if (!email || profileEmailError(email)) return null;
  return email;
}
