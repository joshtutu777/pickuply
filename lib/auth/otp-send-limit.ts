export const otpSendLimits = {
  phone: {
    scope: "otp-phone",
    max: 5,
    windowSeconds: 3600,
    message: "Too many codes for this number. Try again in an hour.",
  },
  ip: {
    scope: "otp-ip",
    max: 10,
    windowSeconds: 3600,
    message: "Too many codes from this network. Try again in an hour.",
  },
} as const;

export type OtpLimitLedger = {
  phones: Map<string, number>;
  ips: Map<string, number>;
};

/** Same order as the database limiter: one phone bucket, then one network bucket. */
export function reserveOtpSend(
  ledger: OtpLimitLedger,
  phoneKey: string,
  ipKey: string,
): string | null {
  const phoneCount = ledger.phones.get(phoneKey) ?? 0;
  const ipCount = ledger.ips.get(ipKey) ?? 0;
  if (phoneCount >= otpSendLimits.phone.max) return otpSendLimits.phone.message;
  if (ipCount >= otpSendLimits.ip.max) return otpSendLimits.ip.message;
  ledger.phones.set(phoneKey, phoneCount + 1);
  ledger.ips.set(ipKey, ipCount + 1);
  return null;
}
