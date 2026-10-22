const NAME_CHARS = /^[\p{L} .'\u2019-]+$/u;

/** Trimmed full name, or null when it is empty, too long, or has other characters. */
export function validateFullName(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length < 1 || trimmed.length > 80) return null;
  if (!NAME_CHARS.test(trimmed)) return null;
  if (!/\p{L}/u.test(trimmed)) return null;
  return trimmed;
}

/** First word of a saved name. Blank names return null so the header can omit it. */
export function firstName(fullName: string | null | undefined): string | null {
  const trimmed = fullName?.trim() ?? "";
  if (!trimmed) return null;
  const token = trimmed.split(/\s+/)[0];
  return token || null;
}
