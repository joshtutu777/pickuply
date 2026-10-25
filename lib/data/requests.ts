import { validateFullName } from "../auth/name";
import { photoMaxBytes } from "../constants";
import { loadPhoto } from "../photo-store";
import { createClient } from "../supabase/client";
import type { RequestDraft } from "../types";
import { saveJobPlaces } from "../maps/save-places";
import { requestPayload } from "./request-payload";

const submissionKey = "pickuply.submission-id";

export class RequestSubmitError extends Error {
  readonly code: "auth" | "missing-photo" | "upload" | "rejected" | "network";
  readonly missingPhotoIds: string[];

  constructor(
    code: RequestSubmitError["code"],
    message: string,
    missingPhotoIds: string[] = [],
  ) {
    super(message);
    this.code = code;
    this.missingPhotoIds = missingPhotoIds;
  }
}

export type PhotoProgress = "waiting" | "uploading" | "done" | "error";

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

function photoPath(jobId: string, photoId: string): string {
  return `${jobId}/request/${photoId}.jpg`;
}

function alreadyStored(error: { message?: string; statusCode?: string } | null): boolean {
  if (!error) return false;
  const message = (error.message ?? "").toLowerCase();
  return error.statusCode === "409" || message.includes("already exists") || message.includes("duplicate");
}

/**
 * Creates the request as the signed-in customer, then uploads any photos that
 * are not already recorded. A second call keeps the same job and skips finished photos.
 */
export async function createRequest(
  draft: RequestDraft,
  photoIds: string[],
  onProgress?: (photoId: string, state: PhotoProgress) => void,
): Promise<{ id: string }> {
  const supabase = createClient();
  const user = await supabase.auth.getUser();
  if (user.error || !user.data.user) {
    throw new RequestSubmitError("auth", "Sign in again before saving this request.");
  }

  const email = draft.customerEmail.trim();
  if (email) {
    const saved = await supabase.rpc("save_profile_email", { next_email: email });
    if (saved.error) {
      throw new RequestSubmitError(
        "rejected",
        saved.error.message.includes("email is not valid")
          ? "Enter a valid email, or leave it blank."
          : "We couldn't save this request. Your draft is still here.",
      );
    }
  }

  const id = submissionId();
  const payload = requestPayload(draft);
  payload.has_photo = photoIds.length > 0;
  const created = await supabase.rpc("create_customer_request", {
    request_id: id,
    payload,
  });
  if (!created.error && created.data) {
    await saveJobPlaces(id, {
      pickupUnit: draft.pickupUnit,
      dropoffUnit: draft.dropoffUnit,
      pickupLat: draft.pickupLat,
      pickupLng: draft.pickupLng,
      dropoffLat: draft.dropoffLat,
      dropoffLng: draft.dropoffLng,
      pickupVerified: draft.pickupVerified,
      dropoffVerified: draft.dropoffVerified,
    });
  }
  if (created.error || !created.data) {
    const message = created.error?.message ?? "";
    if (/sign in required|jwt|session/i.test(message)) {
      throw new RequestSubmitError("auth", "Sign in again before saving this request.");
    }
    if (/Georgia ZIP/i.test(message)) {
      throw new RequestSubmitError("rejected", "Pickuply currently serves Georgia ZIP codes only.");
    }
    if (/already saved with different details/i.test(message)) {
      throw new RequestSubmitError(
        "rejected",
        "This request was already saved. Start over to send a new one. The saved request was not changed.",
      );
    }
    if (/failed to fetch|network|timeout/i.test(message)) {
      throw new RequestSubmitError("network", "We couldn't reach Pickuply. Your draft is still here.");
    }
    throw new RequestSubmitError(
      "rejected",
      "We couldn't save this request. Your draft is still here.",
    );
  }

  // The request already asked for a name. Keep it on the profile so account
  // pages don't send this person back to the name step.
  const name = validateFullName(draft.customerName);
  if (name) {
    const profile = await supabase.from("profiles").select("full_name").eq("id", user.data.user.id).maybeSingle();
    const current = typeof profile.data?.full_name === "string" ? profile.data.full_name.trim() : "";
    if (!profile.error && profile.data && !current) {
      await supabase.from("profiles").update({ full_name: name }).eq("id", user.data.user.id);
    }
  }

  const recorded = await supabase
    .from("job_photos")
    .select("storage_path")
    .eq("job_id", id)
    .eq("stage", "request");
  if (recorded.error) {
    throw new RequestSubmitError("network", "We couldn't check the photos. Your draft is still here.");
  }
  const done = new Set((recorded.data ?? []).map((row) => row.storage_path));
  const missing: string[] = [];

  for (const photoId of photoIds) {
    const path = photoPath(id, photoId);
    if (done.has(path)) {
      onProgress?.(photoId, "done");
      continue;
    }
    const blob = await loadPhoto(photoId);
    if (!blob) {
      missing.push(photoId);
      onProgress?.(photoId, "error");
      continue;
    }
    if (blob.type !== "image/jpeg" || blob.size > photoMaxBytes) {
      onProgress?.(photoId, "error");
      throw new RequestSubmitError(
        "upload",
        "One photo is not a prepared JPEG or is too large. Remove it and choose it again.",
      );
    }
    onProgress?.(photoId, "uploading");
    const uploaded = await supabase.storage.from("job-photos").upload(path, blob, {
      contentType: "image/jpeg",
      upsert: false,
    });
    if (uploaded.error && !alreadyStored(uploaded.error)) {
      onProgress?.(photoId, "error");
      throw new RequestSubmitError("upload", "A photo didn't upload. You can try the remaining photos again.");
    }
    const attached = await supabase.rpc("attach_request_photo", {
      target_job_id: id,
      target_path: path,
    });
    if (attached.error || !attached.data) {
      onProgress?.(photoId, "error");
      throw new RequestSubmitError("upload", "A photo didn't upload. You can try the remaining photos again.");
    }
    onProgress?.(photoId, "done");
  }

  if (missing.length > 0) {
    throw new RequestSubmitError(
      "missing-photo",
      "Choose the missing photos again. The request itself is saved.",
      missing,
    );
  }

  return { id: created.data as string };
}
