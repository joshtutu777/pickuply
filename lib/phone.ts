/** US numbers become +1 and ten digits. Anything else is invalid. */
export function normalizeUsPhone(value: string): string | null {
  const digits = value.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

/** Last four digits only. The rest of the number stays hidden. */
export function maskUsPhone(value: string): string | null {
  const normalized = normalizeUsPhone(value);
  if (!normalized) return null;
  const last4 = normalized.slice(-4);
  return `(\u2022\u2022\u2022) \u2022\u2022\u2022-${last4}`;
}

/** Shown after a code is accepted for sending. The full number is not included. */
export function codeSentMessage(value: string): string | null {
  const mask = maskUsPhone(value);
  if (!mask) return null;
  return `Enter the 6-digit code for ${mask}.`;
}
