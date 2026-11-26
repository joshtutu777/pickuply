/** US numbers become +1 and ten digits. Anything else is invalid. */
export function normalizeUsPhone(value: string): string | null {
  const digits = value.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

/**
 * A number safe to hand to the text provider.
 * Sign-in still uses the stored value. This does not rewrite it.
 * Area codes and exchanges cannot start with 0 or 1.
 */
export function transactionalPhone(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = normalizeUsPhone(value);
  if (!normalized) return null;
  const national = normalized.slice(2);
  if (national[0] === "0" || national[0] === "1") return null;
  if (national[3] === "0" || national[3] === "1") return null;
  return normalized;
}

/** Readable number for the signed-in person and for an admin. */
export function formatUsPhone(value: string): string | null {
  const normalized = normalizeUsPhone(value);
  if (!normalized) return null;
  const digits = normalized.slice(2);
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
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
