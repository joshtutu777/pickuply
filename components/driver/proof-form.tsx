"use client";

import { useState, type FormEvent } from "react";
import { photoMaxBytes } from "@/lib/constants";
import { compressImage, prepareProofVideo } from "@/lib/photos";
import { createClient } from "@/lib/supabase/client";

export function ProofForm({
  jobId,
  locationEnabled,
}: {
  jobId: string;
  locationEnabled: boolean;
}) {
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const file = data.get("file");
    const stage = String(data.get("stage") ?? "");
    const note = String(data.get("note") ?? "");
    const share = data.get("shareLocation") === "on";
    if (!(file instanceof File) || file.size === 0) {
      setMessage("Choose a photo or a short video.");
      return;
    }
    setPending(true);
    setMessage(null);
    try {
      const video = file.type.startsWith("video/");
      const blob = video ? await prepareProofVideo(file) : await compressImage(file);
      if (!video && blob.size > photoMaxBytes) {
        throw new Error("That photo is too large.");
      }
      const id = crypto.randomUUID();
      const path = `${jobId}/${stage}/${id}.${video ? "webm" : "jpg"}`;
      let lat: number | null = null;
      let lng: number | null = null;
      if (share && locationEnabled && "geolocation" in navigator) {
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
        target_job: jobId,
        photo_stage: stage,
        storage_path: path,
        photo_note: note,
        media_kind: video ? "video" : "photo",
        share_location: share && locationEnabled,
        raw_lat: lat,
        raw_lng: lng,
      });
      if (recorded.error) throw new Error("The proof could not be recorded.");
      form.reset();
      setMessage("Proof saved. It cannot be replaced.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The proof could not be saved.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="mt-6 grid gap-3 rounded-3xl bg-paper-raised p-4 ring-1 ring-line">
      <h2 className="text-lg font-semibold text-ink">Add proof</h2>
      <p className="text-base text-muted">
        Photos are saved as new files so location details in the original are removed. A video must be 30 seconds or less.
      </p>
      <label className="text-base font-semibold" htmlFor="proof-stage">
        Step
        <select id="proof-stage" name="stage" className="mt-2 min-h-12 w-full rounded-2xl border border-line px-4" defaultValue="pickup">
          <option value="pickup">Pickup</option>
          <option value="dropoff">Drop-off</option>
          <option value="dump_receipt">Receipt or pickup slip</option>
        </select>
      </label>
      <label className="text-base font-semibold" htmlFor="proof-note">
        Note about existing damage
        <input id="proof-note" name="note" maxLength={300} className="mt-2 min-h-12 w-full rounded-2xl border border-line px-4" />
      </label>
      <label className="text-base font-semibold" htmlFor="proof-file">
        Photo or video
        <input id="proof-file" name="file" type="file" accept="image/*,video/*" className="mt-2 block w-full" />
      </label>
      <label className="flex min-h-12 items-center gap-3 text-base">
        <input type="checkbox" name="shareLocation" disabled={!locationEnabled} />
        Share an approximate location with Pickuply
      </label>
      <p className="text-sm text-muted">
        {locationEnabled
          ? "This is off unless you check it. Pickuply stores a rounded location that customers cannot see."
          : "Approximate location is off for every job."}
      </p>
      {message ? <p className="text-base text-ink">{message}</p> : null}
      <button
        type="submit"
        disabled={pending}
        className="inline-flex min-h-12 items-center justify-center rounded-full bg-brand px-6 font-semibold text-white disabled:opacity-60"
      >
        {pending ? "Saving" : "Save proof"}
      </button>
    </form>
  );
}
