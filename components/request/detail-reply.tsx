"use client";

import { useState } from "react";
import { answerDetailRequest } from "@/app/jobs/actions";
import { compressImage } from "@/lib/photos";
import { createClient } from "@/lib/supabase/client";

const labels: Record<string, string> = {
  stairs: "Stairs",
  size: "Item size",
  pieces: "Number of pieces",
  item_value: "Approximate item value",
  access_notes: "Access notes",
  photos: "Another photo",
};

export function DetailReply({
  jobId,
  items,
  note,
}: {
  jobId: string;
  items: string[];
  note: string;
}) {
  const [photoError, setPhotoError] = useState("");
  const [photoCount, setPhotoCount] = useState(0);
  const [uploading, setUploading] = useState(false);
  const asked = items.filter((item) => labels[item]);

  async function addPhotos(list: FileList | null) {
    const files = Array.from(list ?? []).slice(0, 4);
    if (files.length === 0) return;
    setUploading(true);
    setPhotoError("");
    try {
      const supabase = createClient();
      for (const file of files) {
        const blob = await compressImage(file);
        const path = `${jobId}/request/${crypto.randomUUID()}.jpg`;
        const uploaded = await supabase.storage.from("job-photos").upload(path, blob, {
          contentType: "image/jpeg",
          upsert: false,
        });
        if (uploaded.error) throw new Error("A photo didn't upload. Try again.");
        const attached = await supabase.rpc("attach_request_photo", {
          target_job_id: jobId,
          target_path: path,
        });
        if (attached.error) throw new Error("A photo didn't upload. Try again.");
        setPhotoCount((count) => count + 1);
      }
    } catch (error) {
      setPhotoError(error instanceof Error ? error.message : "A photo didn't upload. Try again.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <form id="details" action={answerDetailRequest} className="mx-auto mt-6 w-full max-w-xl space-y-4 px-4">
      <h2 className="text-xl font-semibold text-ink">Pickuply needs a few details</h2>
      {note ? <p className="text-base text-ink">{note}</p> : null}
      <ul className="list-disc space-y-1 pl-5 text-base text-ink">
        {asked.map((item) => (
          <li key={item}>{labels[item]}</li>
        ))}
      </ul>
      <input type="hidden" name="jobId" value={jobId} />
      {asked.includes("stairs") ? (
        <div className="grid gap-3">
          <label className="block text-base font-semibold text-ink" htmlFor="stairs-pickup">
            Stairs at pickup
            <select id="stairs-pickup" name="stairsPickup" className="mt-2 min-h-12 w-full rounded-2xl border border-line px-4">
              <option value="">Skip</option>
              <option value="0">None</option>
              <option value="1">1 flight</option>
              <option value="2">2 flights</option>
              <option value="3">3+ flights</option>
            </select>
          </label>
          <label className="block text-base font-semibold text-ink" htmlFor="stairs-dropoff">
            Stairs at drop-off
            <select id="stairs-dropoff" name="stairsDropoff" className="mt-2 min-h-12 w-full rounded-2xl border border-line px-4">
              <option value="">Skip</option>
              <option value="0">None</option>
              <option value="1">1 flight</option>
              <option value="2">2 flights</option>
              <option value="3">3+ flights</option>
            </select>
          </label>
        </div>
      ) : null}
      {asked.includes("size") ? (
        <label className="block text-base font-semibold text-ink" htmlFor="detail-size">
          Item size
          <select id="detail-size" name="size" className="mt-2 min-h-12 w-full rounded-2xl border border-line px-4">
            <option value="">Skip</option>
            <option value="small">Small</option>
            <option value="medium">Medium</option>
            <option value="large">Large</option>
            <option value="xl">Extra large</option>
          </select>
        </label>
      ) : null}
      {asked.includes("pieces") ? (
        <label className="block text-base font-semibold text-ink" htmlFor="detail-pieces">
          Number of pieces
          <input id="detail-pieces" name="pieces" inputMode="numeric" className="mt-2 min-h-12 w-full rounded-2xl border border-line px-4" />
        </label>
      ) : null}
      {asked.includes("item_value") ? (
        <label className="block text-base font-semibold text-ink" htmlFor="detail-value">
          Approximate item value in dollars
          <input id="detail-value" name="itemValue" inputMode="decimal" className="mt-2 min-h-12 w-full rounded-2xl border border-line px-4" />
        </label>
      ) : null}
      {asked.includes("access_notes") ? (
        <label className="block text-base font-semibold text-ink" htmlFor="detail-access">
          Access notes
          <textarea id="detail-access" name="accessNotes" className="mt-2 min-h-24 w-full rounded-2xl border border-line px-4 py-3" />
        </label>
      ) : null}
      {asked.includes("photos") ? (
        <label className="block text-base font-semibold text-ink" htmlFor="detail-photos">
          Photos
          <input
            id="detail-photos"
            type="file"
            accept="image/*"
            multiple
            className="mt-2 block w-full text-base"
            disabled={uploading}
            onChange={(event) => {
              void addPhotos(event.target.files);
              event.target.value = "";
            }}
          />
        </label>
      ) : null}
      {photoCount > 0 ? <p className="text-base text-ink">{photoCount} photo{photoCount === 1 ? "" : "s"} added.</p> : null}
      {photoError ? (
        <p role="alert" className="text-base text-danger">
          {photoError}
        </p>
      ) : null}
      <label className="block text-base font-semibold text-ink" htmlFor="detail-message">
        Your answer
        <textarea id="detail-message" name="message" className="mt-2 min-h-24 w-full rounded-2xl border border-line px-4 py-3" />
      </label>
      <button
        type="submit"
        disabled={uploading}
        className="inline-flex min-h-12 items-center justify-center rounded-full bg-brand px-6 font-semibold text-white"
      >
        Send answers
      </button>
    </form>
  );
}
