const secretPattern = /Bearer\s+\S+|sk_(?:test|live)_\S+|whsec_\S+/gi;

/** A short failure note for the admin health page. Secrets are removed before storage. */
export function cronErrorText(error: unknown, secret?: string | null): string {
  const raw = error instanceof Error ? error.message : "The scheduled job failed.";
  let text = raw.replace(secretPattern, "[redacted]");
  if (secret && secret.length >= 8) text = text.split(secret).join("[redacted]");
  const trimmed = text.replace(/\s+/g, " ").trim().slice(0, 300);
  return trimmed || "The scheduled job failed.";
}
