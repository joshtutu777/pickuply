export const otpErrorCopy = {
  invalidNumber: "Enter a valid US phone number.",
  badCode: "That code is wrong or expired. Request a new one.",
  tooMany: "Too many attempts. Wait a minute and try again.",
  network: "We couldn't reach sign-in. Check your connection and try again.",
  smsUnavailable: "Text messages are not available right now. The SMS provider is not configured.",
  sendFailed: "We couldn't send a code. Try again.",
} as const;

export type OtpPhase = "send" | "verify";

export type OtpErrorInput = {
  message?: string;
  code?: string;
  status?: number;
  name?: string;
};

/**
 * Maps a provider error to our own sentence.
 * The provider text can contain the phone number, so it is never shown or returned.
 */
export function mapOtpError(error: OtpErrorInput, phase: OtpPhase): string {
  const message = (error.message ?? "").toLowerCase();
  const code = (error.code ?? "").toLowerCase();
  const name = (error.name ?? "").toLowerCase();
  const status = error.status ?? 0;

  if (
    name.includes("retry") ||
    name.includes("fetch") ||
    message.includes("failed to fetch") ||
    message.includes("network") ||
    message.includes("timeout")
  ) {
    return otpErrorCopy.network;
  }

  if (
    status === 429 ||
    code.includes("rate") ||
    code.includes("over_request") ||
    code.includes("over_sms") ||
    message.includes("rate limit") ||
    message.includes("too many") ||
    message.includes("only request this after")
  ) {
    return otpErrorCopy.tooMany;
  }

  if (
    code.includes("provider") ||
    code === "sms_send_failed" ||
    code === "phone_provider_disabled" ||
    message.includes("provider") ||
    message.includes("error sending") ||
    (message.includes("sms") &&
      (message.includes("disabled") ||
        message.includes("not configured") ||
        message.includes("not enabled")))
  ) {
    return otpErrorCopy.smsUnavailable;
  }

  if (phase === "verify") return otpErrorCopy.badCode;

  if (
    status === 400 ||
    status === 422 ||
    code.includes("validation") ||
    message.includes("invalid") ||
    message.includes("phone")
  ) {
    return otpErrorCopy.invalidNumber;
  }

  return otpErrorCopy.sendFailed;
}
