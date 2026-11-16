"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { PhotoField } from "@/components/photos/photo-field";
import { prepareProofVideo } from "@/lib/photos";
import { createClient } from "@/lib/supabase/client";

export function ProofForm({
  jobId,
  locationEnabled,
  defaultStage = "pickup",
  idPrefix = "",
  submitLabel = "Save proof",
}: {
  jobId: string;
  locationEnabled: boolean;
  defaultStage?: "pickup" | "dropoff" | "dump_receipt" | "no_show";
  idPrefix?: string;
  submitLabel?: string;
}) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [photo, setPhoto] = useState<File | null>(null);
  const [video, setVideo] = useState<File | null>(null);
  const [photoKey, setPhotoKey] = useState(0);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const stage = String(data.get("stage") ?? "");
    const note = String(data.get("note") ?? "");
    const share = data.get("shareLocation") === "on";
    const chosenVideo = video;
    const chosenPhoto = photo;
    if (!chosenVideo && !chosenPhoto) {
      setMessage("Choose a photo or a short video.");
      return;
    }
    setPending(true);
    setMessage(null);
    try {
      const blob = chosenVideo ? await prepareProofVideo(chosenVideo) : chosenPhoto;
      if (!blob) throw new Error("Choose a photo or a short video.");
      const id = crypto.randomUUID();
      const path = `${jobId}/${stage}/${id}.${chosenVideo ? "webm" : "jpg"}`;
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
        contentType: chosenVideo ? "video/webm" : "image/jpeg",
        upsert: false,
      });
      if (uploaded.error) throw new Error("The file could not be saved.");
      const recorded = await supabase.rpc("record_proof", {
        target_job: jobId,
        photo_stage: stage,
        storage_path: path,
        photo_note: note,
        media_kind: chosenVideo ? "video" : "photo",
        share_location: share && locationEnabled,
        raw_lat: lat,
        raw_lng: lng,
      });
      if (recorded.error) throw new Error("The proof could not be recorded.");
      form.reset();
      setPhoto(null);
      setVideo(null);
      setPhotoKey((current) => current + 1);
      router.refresh();
      setMessage("Proof saved. It cannot be replaced.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The proof could not be saved.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="grid gap-2 rounded-3xl bg-paper-raised p-3 ring-1 ring-line">
      <h2 className="text-lg font-semibold text-ink">Add proof</h2>
      <PhotoField
        key={photoKey}
        id={`${idPrefix}proof-photo`}
        label="Photo"
        hint="Take a picture or choose one."
        onPhotos={(files) => {
          setPhoto(files[0] ?? null);
          setVideo(null);
        }}
      />
      <label className="text-base font-semibold" htmlFor={`${idPrefix}proof-video`}>
        Or a short video
        <input
          id={`${idPrefix}proof-video`}
          type="file"
          accept="video/*"
          className="mt-2 block min-h-12 w-full text-base"
          onChange={(event) => {
            setVideo(event.target.files?.[0] ?? null);
            setPhoto(null);
          }}
        />
      </label>
      <p className="text-sm text-muted">
        Photos are saved as new files so location details in the original are removed. A video must be 30 seconds or less.
      </p>
      <label className="text-base font-semibold" htmlFor={`${idPrefix}proof-stage`}>
        Step
        <select id={`${idPrefix}proof-stage`} name="stage" className="mt-2 min-h-12 w-full rounded-2xl border border-line px-4" defaultValue={defaultStage}>
          <option value="pickup">Pickup</option>
          <option value="dropoff">Drop-off</option>
          <option value="dump_receipt">Receipt or pickup slip</option>
          <option value="no_show">Wait photo</option>
        </select>
      </label>
      <label className="text-base font-semibold" htmlFor={`${idPrefix}proof-note`}>
        Note about existing damage
        <input id={`${idPrefix}proof-note`} name="note" maxLength={300} className="mt-2 min-h-12 w-full rounded-2xl border border-line px-4" />
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
        {pending ? "Saving" : submitLabel}
      </button>
    </form>
  );
}
