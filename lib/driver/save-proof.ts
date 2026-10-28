"use client";

import { photoMaxBytes } from "@/lib/constants";
import { proofMediaKind } from "@/lib/jobs/proof-file";
import { compressImage, prepareProofVideo } from "@/lib/photos";
import { createClient } from "@/lib/supabase/client";

/** Stores a driver proof photo or video and records it on the job. */
export async function saveDriverProof(input: {
  jobId: string;
  stage: string;
  file: File;
  note: string;
  shareLocation: boolean;
  locationEnabled: boolean;
}): Promise<void> {
  const kind = proofMediaKind(input.file);
  if (!kind) {
    throw new Error("Choose a photo or a short video. Other file types are not accepted.");
  }
  const video = kind === "video";
  const blob = video ? await prepareProofVideo(input.file) : await compressImage(input.file);
  if (!video && blob.size > photoMaxBytes) {
    throw new Error("That photo is too large.");
  }
  const id = crypto.randomUUID();
  const path = `${input.jobId}/${input.stage}/${id}.${video ? "webm" : "jpg"}`;
  let lat: number | null = null;
  let lng: number | null = null;
  if (input.shareLocation && input.locationEnabled && "geolocation" in navigator) {
    const position = await new Promise<GeolocationPosition>((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 8000 });
    }).catch(() => null);
    if (position) {
      lat = Math.round(position.coords.latitude * 100) / 100;
      lng = Math.round(position.coords.longitude * 100) / 100;
    }
  }
  const supabase = createClient();
  const uploaded = await supabase.storage.from("job-photos").upload(path, blob, {
    contentType: video ? "video/webm" : "image/jpeg",
    upsert: false,
  });
  if (uploaded.error) throw new Error("The file could not be saved.");
  const recorded = await supabase.rpc("record_proof", {
    target_job: input.jobId,
    photo_stage: input.stage,
    storage_path: path,
    photo_note: input.note,
    media_kind: video ? "video" : "photo",
    share_location: input.shareLocation && input.locationEnabled,
    raw_lat: lat,
    raw_lng: lng,
  });
  if (recorded.error) throw new Error("The proof could not be recorded.");
}
