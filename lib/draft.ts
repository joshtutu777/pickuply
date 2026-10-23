import { sensitiveDraftFields, type RequestDraft } from "./types";
import { emptyDraft } from "./types";

const draftKey = "pickuply.request-draft";

export type StoredDraft = {
  draft: RequestDraft;
  photoIds: string[];
  savedAt: string;
};

/** Phone, email, and exact street addresses are removed before anything is written. */
export function toStoredDraft(draft: RequestDraft, photoIds: string[], savedAt: string): StoredDraft {
  const copy: RequestDraft = { ...draft };
  for (const field of sensitiveDraftFields) {
    copy[field] = "";
  }
  copy.pickupUnit = "";
  copy.dropoffUnit = "";
  copy.pickupLat = null;
  copy.pickupLng = null;
  copy.dropoffLat = null;
  copy.dropoffLng = null;
  copy.pickupVerified = false;
  copy.dropoffVerified = false;
  return { draft: copy, photoIds, savedAt };
}

export function loadStoredDraft(): StoredDraft | null {
  if (typeof localStorage === "undefined") return null;
  const raw = localStorage.getItem(draftKey);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as StoredDraft;
    if (!parsed?.draft) return null;
    const stored = toStoredDraft(parsed.draft, parsed.photoIds ?? [], parsed.savedAt);
    return {
      ...stored,
      draft: { ...emptyDraft(), ...stored.draft },
    };
  } catch {
    return null;
  }
}

export function saveStoredDraft(draft: RequestDraft, photoIds: string[]): void {
  const record = toStoredDraft(draft, photoIds, new Date().toISOString());
  localStorage.setItem(draftKey, JSON.stringify(record));
}

export function clearStoredDraft(): void {
  localStorage.removeItem(draftKey);
}
