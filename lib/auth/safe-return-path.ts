const MAX_LENGTH = 2048;
const DANGER = /[\u0000-\u001F\u007F\u2028\u2029\\:@\s]/u;
const BASE = "http://pickuply.internal";

/**
 * A single in-app path, or null when the value could send someone off this site.
 * Callers must treat null as "no return path", not as a URL to follow.
 */
export function safeReturnPath(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_LENGTH) return null;
  if (!isSingleSlashPath(trimmed) || hasDanger(trimmed)) return null;

  const decoded = decodeOnce(trimmed);
  if (decoded === null) return null;
  if (decoded !== trimmed) {
    const twice = decodeOnce(decoded);
    if (twice === null || twice !== decoded) return null;
  }
  if (!isSingleSlashPath(decoded) || hasDanger(decoded)) return null;

  let url: URL;
  try {
    url = new URL(decoded, BASE);
  } catch {
    return null;
  }
  if (url.origin !== BASE || url.username !== "" || url.password !== "") return null;
  if (!url.pathname.startsWith("/")) return null;
  return decoded;
}

function isSingleSlashPath(value: string): boolean {
  return value.startsWith("/") && !value.startsWith("//");
}

function hasDanger(value: string): boolean {
  return value.includes("//") || DANGER.test(value);
}

function decodeOnce(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}
