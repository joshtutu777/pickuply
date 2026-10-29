/**
 * App screens call these limits before asking Supabase to text a code.
 * A direct request to Supabase Auth does not. Supabase still applies its own
 * project SMS cap, per-number resend window, and per-IP request cap.
 * Those hosted caps are not this policy. A Send SMS hook is required before
 * every text, including a direct Auth request, uses this policy.
 * Supabase does not enforce five wrong codes on POST /auth/v1/verify.
 * That counter runs only when the person uses the Pickuply form.
 */
export const otpLimitCoverage = {
  appSendChecksCustomPolicy: true,
  directAuthSendChecksCustomPolicy: false,
  sendSmsHookRequiredForEveryText: true,
  appVerifyChecksFiveWrongCodes: true,
  directAuthVerifyChecksFiveWrongCodes: false,
} as const;

export const otpSendPolicy = {
  cooldownMs: 30_000,
  phoneDailyMax: 10,
  phoneDailyMs: 24 * 60 * 60 * 1000,
  burstDistinctPhones: 15,
  burstMs: 10 * 60 * 1000,
  sustainedDistinctPhones: 80,
  sustainedMs: 60 * 60 * 1000,
  verifyFailures: 5,
  verifyWindowMs: 10 * 60 * 1000,
} as const;

export const otpSendMessages = {
  cooldown: "Wait 30 seconds before requesting another code.",
  phoneDaily: "Too many codes for this number today. Try again tomorrow.",
  burst: "Too many new numbers from this network right now. Try again in a few minutes.",
  sustained: "Too many new numbers from this network. Try again later.",
  verify: "Too many incorrect codes. Wait 10 minutes and request a new one.",
} as const;

export type OtpSendEvent = {
  phoneKey: string;
  ipKey: string;
  at: number;
};

/**
 * Decides whether a code can be sent.
 * A shared network is not a person. The network check counts distinct numbers, and only when that count looks like a script.
 * A refused request is not added to the list.
 */
export function reserveOtpSend(
  events: OtpSendEvent[],
  phoneKey: string,
  ipKey: string,
  now: number,
): string | null {
  const phoneEvents = events.filter((event) => event.phoneKey === phoneKey);
  const latest = phoneEvents.reduce((max, event) => Math.max(max, event.at), 0);
  if (latest > 0 && now - latest < otpSendPolicy.cooldownMs) return otpSendMessages.cooldown;

  const dayCount = phoneEvents.filter((event) => now - event.at < otpSendPolicy.phoneDailyMs).length;
  if (dayCount >= otpSendPolicy.phoneDailyMax) return otpSendMessages.phoneDaily;

  const burstPhones = new Set(
    events
      .filter((event) => event.ipKey === ipKey && now - event.at < otpSendPolicy.burstMs)
      .map((event) => event.phoneKey),
  );
  if (!burstPhones.has(phoneKey) && burstPhones.size >= otpSendPolicy.burstDistinctPhones) {
    return otpSendMessages.burst;
  }

  const sustainedPhones = new Set(
    events
      .filter((event) => event.ipKey === ipKey && now - event.at < otpSendPolicy.sustainedMs)
      .map((event) => event.phoneKey),
  );
  if (!sustainedPhones.has(phoneKey) && sustainedPhones.size >= otpSendPolicy.sustainedDistinctPhones) {
    return otpSendMessages.sustained;
  }

  events.push({ phoneKey, ipKey, at: now });
  return null;
}

/** Five wrong codes in ten minutes stop another try. A success does not add a failure. */
export function otpVerifyBlocked(failures: number[], now: number): boolean {
  return failures.filter((at) => now - at < otpSendPolicy.verifyWindowMs).length >= otpSendPolicy.verifyFailures;
}
