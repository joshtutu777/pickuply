import { otpErrorCopy } from "@/lib/auth/otp-errors";
import { isSyntheticOtpPhone } from "@/lib/auth/synthetic-otp";

export type OtpSendDeps = {
  synthetic?: (phone: string) => boolean;
  reserve: (phone: string) => Promise<string | null>;
  send: (phone: string) => Promise<string | null>;
};

/**
 * Shared by customer signup, driver signup, sign-in, and resend.
 * A refused request never calls the text provider.
 * A synthetic number skips the shared counters and still goes through sign-in, which does not text that number.
 */
export async function deliverSignInCode(phone: string, deps: OtpSendDeps): Promise<string | null> {
  const synthetic = deps.synthetic ?? isSyntheticOtpPhone;
  if (!synthetic(phone)) {
    const limited = await deps.reserve(phone);
    if (limited) return limited;
  }
  return deps.send(phone);
}

export type OtpVerifyDeps = {
  synthetic?: (phone: string) => boolean;
  blocked: (phone: string) => Promise<string | null>;
  verify: (phone: string, token: string) => Promise<string | null>;
  noteFailure: (phone: string) => Promise<void>;
};

/** A blocked number is not sent to the provider. A wrong or expired code is counted. A network failure is not. */
export async function checkSignInCode(phone: string, token: string, deps: OtpVerifyDeps): Promise<string | null> {
  const synthetic = deps.synthetic ?? isSyntheticOtpPhone;
  if (!synthetic(phone)) {
    const blocked = await deps.blocked(phone);
    if (blocked) return blocked;
  }
  const result = await deps.verify(phone, token);
  if (result === otpErrorCopy.badCode && !synthetic(phone)) await deps.noteFailure(phone);
  return result;
}
