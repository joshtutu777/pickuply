import { z } from "zod";

/** Trim and lowercase so the same address is stored once. */
export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

/** Blank is allowed. A filled-in address must be an email and stay within the database limit. */
export function profileEmailError(value: string): string | null {
  const email = value.trim();
  if (!email) return null;
  if (email.length > 200 || !z.string().email().safeParse(email).success) {
    return "Enter a valid email, or leave it blank.";
  }
  return null;
}

/** A paid booking needs an email. Signup and profile edit still allow a blank address. */
export function bookingEmailError(value: string): string | null {
  const email = value.trim();
  if (!email) return "Enter your email to confirm this booking.";
  if (email.length > 200 || !z.string().email().safeParse(email).success) {
    return "Enter a valid email to confirm this booking.";
  }
  return null;
}

/** Quick Apply requires an email. Profile edit still uses the optional check. */
export function driverApplyEmailError(value: string): string | null {
  const email = value.trim();
  if (!email) return "Enter your email.";
  if (email.length > 200 || !z.string().email().safeParse(email).success) {
    return "Enter a valid email.";
  }
  return null;
}
