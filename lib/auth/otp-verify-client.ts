"use client";

import { prepareSignInVerify, noteSignInVerifyFailure } from "@/app/login/otp-limit";
import { mapOtpError, otpErrorCopy } from "@/lib/auth/otp-errors";
import { createClient } from "@/lib/supabase/client";

/** Checks the server limit, then verifies with the browser session the request form already uses. */
export async function verifyPhoneCode(phone: string, token: string): Promise<string | null> {
  if (!/^\d{6}$/.test(token)) return "Enter the 6-digit code.";
  const blocked = await prepareSignInVerify(phone);
  if (blocked) return blocked;
  try {
    const { error } = await createClient().auth.verifyOtp({ phone, token, type: "sms" });
    if (!error) return null;
    const mapped = mapOtpError(error, "verify");
    if (mapped === otpErrorCopy.badCode) await noteSignInVerifyFailure(phone);
    return mapped;
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : "";
    const name = caught instanceof Error ? caught.name : "";
    return mapOtpError({ message, name }, "verify");
  }
}
