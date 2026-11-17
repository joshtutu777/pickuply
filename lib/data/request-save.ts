export type RequestSaveStage = "client" | "auth" | "profile" | "database" | "response" | "photos" | "analytics";

const submissionKey = "pickuply.submission-id";

/** One id per browser tab so a retry continues the same job. */
export function submissionId(): string {
  const existing = sessionStorage.getItem(submissionKey);
  if (existing && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(existing)) {
    return existing;
  }
  const id = crypto.randomUUID();
  sessionStorage.setItem(submissionKey, id);
  return id;
}

export function clearSubmissionId(): void {
  sessionStorage.removeItem(submissionKey);
}

const services = new Set(["delivery", "free_item", "junk", "construction"]);

export function requestService(value: string): string | null {
  return services.has(value) ? value : null;
}

/** PostgREST and Postgres codes are short tokens. Anything else is dropped. */
export function safeSupabaseCode(code: unknown): string | null {
  return typeof code === "string" && /^[A-Za-z0-9]{1,12}$/.test(code) ? code : null;
}

/**
 * Keeps a database explanation only when it cannot carry a name, phone,
 * address, email, or token. The raw payload is never stored.
 */
export function safeSupabaseMessage(message: unknown): string | null {
  if (typeof message !== "string") return null;
  const text = message.replace(/\s+/g, " ").trim();
  if (text.length < 1 || text.length > 160) return null;
  if (/@|\beyJ\b|sk_|whsec|bearer/i.test(text)) return null;
  if (/\d{3}[-.\s]?\d{3}[-.\s]?\d{4}/.test(text)) return null;
  if (!/^[A-Za-z0-9 ,.'$:_()/-]+$/.test(text)) return null;
  return text;
}

export function supabaseFailureDetail(
  stage: RequestSaveStage,
  error: { code?: string; message?: string } | null,
): { stage: RequestSaveStage; supabaseCode: string | null; safeDetail: string | null } {
  return {
    stage,
    supabaseCode: safeSupabaseCode(error?.code),
    safeDetail: safeSupabaseMessage(error?.message),
  };
}

export function submitErrorText(error: {
  message: string;
  code: string;
  stage: RequestSaveStage;
  supabaseCode: string | null;
  safeDetail: string | null;
}): string {
  if (error.code === "upload" || error.code === "missing-photo") return error.message;
  const reference = [error.stage, error.supabaseCode, error.safeDetail].filter((part) => part).join(" ");
  if (!reference || error.message.includes("Reference:")) return error.message;
  return `${error.message} Reference: ${reference}.`;
}

/**
 * Runs only after the request row exists. A tracking failure is reported as
 * not tracked and never becomes a failed save.
 */
export async function trackSavedRequest(track: () => Promise<void> | void): Promise<boolean> {
  try {
    await track();
    return true;
  } catch {
    return false;
  }
}
