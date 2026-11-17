import { z } from "zod";

/** Same shape the request database accepts: one @ and no spaces, at most 200 characters. */
const requestEmailPattern = /^[^\s@]+@[^\s@]+$/;

/**
 * Required on every request. Blank and surrounding spaces are missing.
 * Anything the database would reject is malformed.
 */
export function requestEmailError(value: string): string | null {
  const email = value.trim();
  if (!email) return "Please enter your email address.";
  if (
    email.length > 200 ||
    !requestEmailPattern.test(email) ||
    !z.string().email().safeParse(email).success
  ) {
    return "Please enter a valid email address.";
  }
  return null;
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

/** Quick Apply requires an email. Profile edit still uses the optional check. */
export function driverApplyEmailError(value: string): string | null {
  const email = value.trim();
  if (!email) return "Enter your email.";
  if (email.length > 200 || !z.string().email().safeParse(email).success) {
    return "Enter a valid email.";
  }
  return null;
}
