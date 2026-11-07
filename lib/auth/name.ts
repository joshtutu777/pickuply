const NAME_CHARS = /^[\p{L} .'\u2019-]+$/u;

/** Trimmed full name, or null when it is empty, too long, or has other characters. */
export function validateFullName(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length < 1 || trimmed.length > 80) return null;
  if (!NAME_CHARS.test(trimmed)) return null;
  if (!/\p{L}/u.test(trimmed)) return null;
  return trimmed;
}

/** One required name part. Empty, too long, or other characters return null. */
export function validateNamePart(value: string): string | null {
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (trimmed.length < 1 || trimmed.length > 40) return null;
  if (!NAME_CHARS.test(trimmed)) return null;
  if (!/\p{L}/u.test(trimmed)) return null;
  return trimmed;
}

/**
 * Split a stored full name only when the split is reliable.
 * One word fills the first name. Exactly two words fill both.
 * Three or more words fill the first word only and leave the last name unknown.
 */
export function reliableNameParts(fullName: string | null | undefined): {
  firstName: string | null;
  lastName: string | null;
} {
  const trimmed = fullName?.trim().replace(/\s+/g, " ") ?? "";
  if (!trimmed) return { firstName: null, lastName: null };
  const tokens = trimmed.split(" ");
  const given = validateNamePart(tokens[0] ?? "");
  if (tokens.length === 1) return { firstName: given, lastName: null };
  if (tokens.length === 2) {
    const family = validateNamePart(tokens[1] ?? "");
    if (given && family) return { firstName: given, lastName: family };
    return { firstName: null, lastName: null };
  }
  return { firstName: given, lastName: null };
}

/** Saved name parts. A missing last name stays missing instead of being invented. */
export function resolvedNames(input: {
  firstName?: string | null;
  lastName?: string | null;
  fullName?: string | null;
}): { firstName: string | null; lastName: string | null; fullName: string | null; complete: boolean } {
  const storedFirst = validateNamePart(input.firstName ?? "");
  const storedLast = validateNamePart(input.lastName ?? "");
  if (storedFirst && storedLast) {
    return {
      firstName: storedFirst,
      lastName: storedLast,
      fullName: `${storedFirst} ${storedLast}`,
      complete: true,
    };
  }
  const split = reliableNameParts(input.fullName);
  if (!storedFirst && !storedLast && split.firstName && split.lastName) {
    return {
      firstName: split.firstName,
      lastName: split.lastName,
      fullName: `${split.firstName} ${split.lastName}`,
      complete: true,
    };
  }
  const storedFull = input.fullName?.trim().replace(/\s+/g, " ") || null;
  return {
    firstName: storedFirst ?? split.firstName,
    lastName: storedLast,
    fullName: storedFull,
    complete: false,
  };
}

/** The name to show. Separate parts win. Otherwise the stored full name is left as it is. */
export function displayFullName(input: {
  firstName?: string | null;
  lastName?: string | null;
  fullName?: string | null;
}): string | null {
  const names = resolvedNames(input);
  if (names.complete && names.fullName) return names.fullName;
  const stored = input.fullName?.trim() ?? "";
  if (stored) return stored;
  if (names.firstName) return names.firstName;
  if (names.lastName) return names.lastName;
  return null;
}

/** First word of a saved name. Blank names return null so the header can omit it. */
export function firstName(fullName: string | null | undefined): string | null {
  const trimmed = fullName?.trim() ?? "";
  if (!trimmed) return null;
  const token = trimmed.split(/\s+/)[0];
  return token || null;
}
