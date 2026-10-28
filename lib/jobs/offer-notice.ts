export type OfferNotice = { jobId: string; message: string };

const storageKey = "pickuply.offer-notice";

export function offerNoticeKey(): string {
  return storageKey;
}

export function readOfferNotice(raw: string | null): OfferNotice | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { jobId?: unknown; message?: unknown };
    if (typeof parsed.jobId !== "string" || parsed.jobId === "") return null;
    if (typeof parsed.message !== "string" || parsed.message === "") return null;
    return { jobId: parsed.jobId, message: parsed.message };
  } catch {
    return null;
  }
}

export function writeOfferNotice(notice: OfferNotice): string {
  return JSON.stringify({ jobId: notice.jobId, message: notice.message });
}
