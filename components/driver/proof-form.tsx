"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { UploadPicker } from "@/components/upload-picker";
import { saveDriverProof } from "@/lib/driver/save-proof";

export function ProofForm({
  jobId,
  locationEnabled,
  defaultStage = "pickup",
  idPrefix = "",
  formId,
  submitLabel = "Save proof",
  locked = false,
  onFile,
  onSaved,
}: {
  jobId: string;
  locationEnabled: boolean;
  defaultStage?: "pickup" | "dropoff" | "dump_receipt" | "no_show";
  idPrefix?: string;
  formId?: string;
  submitLabel?: string;
  locked?: boolean;
  onFile?: (file: File | null) => void;
  onSaved?: (stage: string) => void;
}) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [pickerKey, setPickerKey] = useState(0);
  const saveLock = useRef(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saveLock.current || locked) return;
    saveLock.current = true;
    const form = event.currentTarget;
    const data = new FormData(form);
    const file = data.get("file");
    const stage = String(data.get("stage") ?? "");
    const note = String(data.get("note") ?? "");
    const share = data.get("shareLocation") === "on";
    if (!(file instanceof File) || file.size === 0) {
      saveLock.current = false;
      setMessage("Choose a photo or a short video.");
      return;
    }
    setPending(true);
    setMessage(null);
    try {
      await saveDriverProof({
        jobId,
        stage,
        file,
        note,
        shareLocation: share,
        locationEnabled,
      });
      form.reset();
      setPickerKey((key) => key + 1);
      onFile?.(null);
      onSaved?.(stage);
      router.refresh();
      setMessage("Proof saved. It cannot be replaced.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The proof could not be saved.");
    } finally {
      saveLock.current = false;
      setPending(false);
    }
  }

  return (
    <form id={formId} onSubmit={(event) => void submit(event)} className="grid gap-2 rounded-3xl bg-paper-raised p-3 ring-1 ring-line">
      <h2 className="text-lg font-semibold text-ink">Add proof</h2>
      <UploadPicker
        key={pickerKey}
        id={`${idPrefix}proof-file`}
        name="file"
        accept="image/*,video/*"
        capture="environment"
        required
        label="Add a photo or video"
        kinds="JPG, PNG, or a video up to 30 seconds"
        busy={pending || locked}
        disabled={pending || locked}
        onChange={(files) => onFile?.(files && files.length > 0 ? files[0] : null)}
      />
      <p className="text-sm text-muted">
        Photos are saved as new files so location details in the original are removed. A video must be 30 seconds or less.
      </p>
      {onFile ? (
        <p className="text-sm text-muted">
          After you choose a photo or video, tap the status button. It saves this proof and moves the job forward.
        </p>
      ) : null}
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
      {message ? (
        <p role={message.startsWith("Proof saved") ? "status" : "alert"} className="text-base text-ink">
          {message}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={pending || locked}
        className="inline-flex min-h-12 items-center justify-center rounded-full bg-brand px-6 font-semibold text-white disabled:opacity-60"
      >
        {pending ? "Uploading..." : submitLabel}
      </button>
    </form>
  );
}
