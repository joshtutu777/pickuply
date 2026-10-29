import { z } from "zod";

/** Trim and lowercase so the same address is stored once. */
export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function emailShapeError(email: string): boolean {
  return email.length > 200 || !z.string().email().safeParse(email).success;
}

/** Blank is allowed. A filled-in address must be an email and stay within the database limit. */
export function profileEmailError(value: string): string | null {
  const email = normalizeEmail(value);
  if (!email) return null;
  if (emailShapeError(email)) return "Enter a valid email, or leave it blank.";
  return null;
}

/** A new customer signup and a pickup request need an email. Profile edit can still be left blank. */
export function customerEmailError(value: string): string | null {
  const email = normalizeEmail(value);
  if (!email) return "Enter your email.";
  if (emailShapeError(email)) return "Enter a valid email.";
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
