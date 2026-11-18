"use client";

import { useEffect, useState, type ReactNode } from "react";
import { BusyMark, UploadMark } from "@/components/upload-picker";
import { imageAccept, prepareStoredPhoto } from "@/lib/photos";

type Prepared = { file: File; url: string };

/**
 * Camera and photo-library picker. The preview is the JPEG that will be stored.
 */
export function PhotoField({
  id,
  label,
  hint,
  use = "photo",
  multiple = false,
  onPhotos,
}: {
  id: string;
  label: ReactNode;
  hint?: string;
  use?: "photo" | "document";
  multiple?: boolean;
  onPhotos: (photos: File[]) => void | Promise<void>;
}) {
  const [status, setStatus] = useState<"idle" | "working" | "error">("idle");
  const [error, setError] = useState("");
  const [previews, setPreviews] = useState<Prepared[]>([]);
  const [pending, setPending] = useState<File[]>([]);

  useEffect(() => {
    return () => {
      for (const preview of previews) URL.revokeObjectURL(preview.url);
    };
  }, [previews]);

  async function run(files: File[]) {
    if (files.length === 0) return;
    setPending(files);
    setStatus("working");
    setError("");
    try {
      const prepared: Prepared[] = [];
      for (const file of files) {
        const blob = await prepareStoredPhoto(file, use);
        const jpeg = new File([blob], "photo.jpg", { type: "image/jpeg" });
        prepared.push({ file: jpeg, url: URL.createObjectURL(jpeg) });
      }
      setPreviews(prepared);
      await onPhotos(prepared.map((item) => item.file));
      setStatus("idle");
    } catch (caught) {
      setStatus("error");
      setError(caught instanceof Error ? caught.message : "This photo couldn't be prepared. Try again.");
    }
  }

  return (
    <div>
      <p id={`${id}-label`} className="text-base font-semibold text-ink">
        {label}
      </p>
      {hint ? <p className="mt-1 text-sm text-muted">{hint}</p> : null}
      <div className="mt-2 grid gap-2 sm:grid-cols-2" role="group" aria-labelledby={`${id}-label`}>
        <input
          id={`${id}-camera`}
          className="sr-only"
          type="file"
          accept={imageAccept}
          capture="environment"
          onChange={(event) => {
            void run([...(event.target.files ?? [])]);
            event.target.value = "";
          }}
        />
        <label
          htmlFor={`${id}-camera`}
          className="flex min-h-28 cursor-pointer flex-col items-center justify-center gap-1 rounded-3xl border-2 border-dashed border-brand bg-brand-soft px-4 py-4 text-center focus-within:ring-2 focus-within:ring-brand"
        >
          <UploadMark />
          <span className="text-base font-semibold text-ink">Take photo</span>
          <span className="text-sm text-muted">Use the camera</span>
        </label>
        <input
          id={`${id}-library`}
          className="sr-only"
          type="file"
          accept={imageAccept}
          multiple={multiple}
          onChange={(event) => {
            void run([...(event.target.files ?? [])]);
            event.target.value = "";
          }}
        />
        <label
          htmlFor={`${id}-library`}
          className="flex min-h-28 cursor-pointer flex-col items-center justify-center gap-1 rounded-3xl border-2 border-dashed border-brand bg-brand-soft px-4 py-4 text-center focus-within:ring-2 focus-within:ring-brand"
        >
          <UploadMark />
          <span className="text-base font-semibold text-ink">Photo library</span>
          <span className="text-sm text-muted">Choose a saved picture</span>
        </label>
      </div>
      {status === "working" ? (
        <p role="status" className="mt-2 inline-flex items-center gap-2 text-base font-semibold text-ink">
          <BusyMark />
          Preparing your photo…
        </p>
      ) : null}
      {status === "error" ? (
        <p role="alert" className="mt-2 text-base text-danger">
          {error}{" "}
          <button type="button" className="min-h-12 font-semibold text-brand" onClick={() => void run(pending)}>
            Try again
          </button>
        </p>
      ) : null}
      {previews.length > 0 ? (
        <ul className="mt-2 grid grid-cols-3 gap-2">
          {previews.map((preview) => (
            <li key={preview.url}>
              {/* The preview is the JPEG we just made, not a remote image. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={preview.url} alt="" className="aspect-square w-full rounded-2xl object-cover" />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
