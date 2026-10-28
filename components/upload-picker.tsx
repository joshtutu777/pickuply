"use client";

import { useState, type ChangeEvent } from "react";

export function UploadPicker({
  id,
  name,
  accept,
  capture,
  multiple = false,
  required = false,
  label,
  kinds,
  onChange,
  busy = false,
  disabled = false,
  success = null,
  error = null,
  clearAfter = false,
}: {
  id: string;
  name?: string;
  accept: string;
  capture?: "environment" | "user";
  multiple?: boolean;
  required?: boolean;
  label: string;
  kinds: string;
  onChange?: (files: FileList | null) => void;
  busy?: boolean;
  disabled?: boolean;
  success?: string | null;
  error?: string | null;
  clearAfter?: boolean;
}) {
  const [selected, setSelected] = useState<string | null>(null);

  function changed(event: ChangeEvent<HTMLInputElement>) {
    const files = event.target.files;
    const names = files && files.length > 0 ? [...files].map((file) => file.name).join(", ") : null;
    setSelected(names);
    onChange?.(files);
    if (clearAfter) event.target.value = "";
  }

  return (
    <div className="grid gap-2">
      <label
        htmlFor={id}
        className="flex min-h-28 cursor-pointer flex-col items-center justify-center gap-1 rounded-3xl border-2 border-dashed border-brand bg-brand-soft px-4 py-4 text-center focus-within:ring-2 focus-within:ring-brand"
      >
        <svg viewBox="0 0 24 24" className="size-8 text-brand" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M8 7.5h1.6l1-1.5h2.8l1 1.5H16a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V9.5a2 2 0 0 1 2-2z" strokeLinejoin="round" />
          <circle cx="12" cy="13" r="2.6" />
        </svg>
        <span className="text-base font-semibold text-ink">{label}</span>
        <span className="text-sm text-muted">
          {required ? "Required" : "Optional"} · {kinds}
        </span>
        <input
          id={id}
          name={name}
          type="file"
          accept={accept}
          capture={capture}
          multiple={multiple}
          disabled={disabled}
          onChange={changed}
          className="sr-only"
        />
      </label>
      {selected ? <p className="text-base text-ink">Selected: {selected}</p> : null}
      {busy ? (
        <p className="text-base font-semibold text-ink" role="status">
          Uploading...
        </p>
      ) : null}
      {success ? (
        <p className="text-base font-semibold text-ink" role="status">
          {success}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-base text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
