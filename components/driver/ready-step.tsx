"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import {
  completeTraining,
  saveInsurance,
  saveKit,
  saveLicense,
  saveServices,
  saveVehicle,
  signAgreement,
} from "@/app/driver/ready/actions";
import { CoverageEditor } from "@/components/driver/coverage-editor";
import { UploadPicker } from "@/components/upload-picker";
import { createClient } from "@/lib/supabase/client";
import { compressImage } from "@/lib/photos";
import type { CoverageDraft } from "@/lib/driver/coverage";

const controlClass =
  "mt-2 min-h-12 w-full rounded-2xl border border-line bg-paper-raised px-4 text-base text-ink";

const vehicleTypes = ["pickup", "van", "suv", "car", "box_truck", "trailer"] as const;

export type ReadyExisting = {
  licenseUrl: string | null;
  licenseExpires: string | null;
  insuranceUrl: string | null;
  insuranceExpires: string | null;
  vehicleType: string | null;
  make: string | null;
  model: string | null;
  year: number | null;
  plate: string | null;
  cargo: number | null;
  vehiclePhoto: string | null;
  equipment: string[];
  helperName: string | null;
  services: string[];
  serviceLevel: string | null;
  fullName: string | null;
  coverage: CoverageDraft;
};

async function upload(userId: string, name: "insurance" | "vehicle" | "license", file: File): Promise<string> {
  if (file.size > 5 * 1024 * 1024) throw new Error("Each photo must be 5 MB or smaller.");
  const prepared = await compressImage(file);
  const path = `${userId}/${name}.jpg`;
  const { error } = await createClient().storage.from("driver-docs").upload(path, prepared, {
    upsert: true,
    contentType: "image/jpeg",
  });
  if (error) throw new Error("We couldn't upload that photo. Try again.");
  return path;
}

export function ReadyStep({
  step,
  userId,
  existing,
  error,
}: {
  step: string;
  userId: string;
  existing: ReadyExisting;
  error?: string;
}) {
  const [photoError, setPhotoError] = useState("");
  const [path, setPath] = useState("");
  const [pending, setPending] = useState(false);
  const kept =
    step === "license" ? existing.licenseUrl : step === "insurance" ? existing.insuranceUrl : existing.vehiclePhoto;

  async function onFile(name: "insurance" | "vehicle" | "license", file: File | null) {
    if (!file) return;
    setPending(true);
    setPhotoError("");
    try {
      setPath(await upload(userId, name, file));
    } catch (caught) {
      setPhotoError(caught instanceof Error ? caught.message : "We couldn't upload that photo.");
    } finally {
      setPending(false);
    }
  }

  function requirePhoto(event: FormEvent) {
    if (!path && !kept) {
      event.preventDefault();
      setPhotoError("Add the photo first.");
    }
  }

  return (
    <div className="mt-6 space-y-4">
      {error ? (
        <p role="alert" className="text-base text-danger">
          {error}
        </p>
      ) : null}
      {photoError ? (
        <p role="alert" className="text-base text-danger">
          {photoError}
        </p>
      ) : null}
      {step === "license" ? (
        <form action={saveLicense} className="space-y-4" onSubmit={requirePhoto}>
          <input type="hidden" name="path" value={path} />
          {existing.licenseUrl ? <p className="text-base text-ink">Your license photo is already on file. Upload a new one only if you need to replace it.</p> : null}
          <UploadPicker id="license-photo" accept="image/jpeg,image/png,image/webp" required label="Add your license photo" kinds="JPG, PNG, or WEBP" clearAfter onChange={(files) => void onFile("license", files?.[0] ?? null)} />
          <label className="block font-semibold" htmlFor="license-expires">
            License expiration
            <input id="license-expires" name="expires" type="date" required defaultValue={existing.licenseExpires ?? ""} className={controlClass} />
          </label>
          <Submit pending={pending} label={existing.licenseUrl ? "Save license" : "Save license"} />
        </form>
      ) : null}
      {step === "insurance" ? (
        <form action={saveInsurance} className="space-y-4" onSubmit={requirePhoto}>
          <input type="hidden" name="path" value={path} />
          {existing.insuranceUrl ? <p className="text-base text-ink">Your insurance photo is already on file. Upload a new one only if you need to replace it.</p> : null}
          <UploadPicker id="insurance-photo" accept="image/jpeg,image/png,image/webp" required label="Add your insurance photo" kinds="JPG, PNG, or WEBP" clearAfter onChange={(files) => void onFile("insurance", files?.[0] ?? null)} />
          <label className="block font-semibold" htmlFor="insurance-expires">
            Insurance expiration
            <input id="insurance-expires" name="expires" type="date" required defaultValue={existing.insuranceExpires ?? ""} className={controlClass} />
          </label>
          <Submit pending={pending} label="Save insurance" />
        </form>
      ) : null}
      {step === "vehicle" ? (
        <form action={saveVehicle} className="space-y-4" onSubmit={requirePhoto}>
          <input type="hidden" name="path" value={path} />
          <label className="block font-semibold" htmlFor="vehicle-type">
            Vehicle type
            <select id="vehicle-type" name="vehicleType" defaultValue={existing.vehicleType ?? "pickup"} className={controlClass}>
              {vehicleTypes.map((type) => (
                <option key={type} value={type}>
                  {type.replaceAll("_", " ")}
                </option>
              ))}
            </select>
          </label>
          <label className="block font-semibold" htmlFor="make">Make<input id="make" name="make" required defaultValue={existing.make ?? ""} className={controlClass} /></label>
          <label className="block font-semibold" htmlFor="model">Model<input id="model" name="model" required defaultValue={existing.model ?? ""} className={controlClass} /></label>
          <label className="block font-semibold" htmlFor="year">Year<input id="year" name="year" inputMode="numeric" required defaultValue={existing.year ?? ""} className={controlClass} /></label>
          <label className="block font-semibold" htmlFor="plate">Plate<input id="plate" name="plate" required defaultValue={existing.plate ?? ""} className={controlClass} /></label>
          <label className="block font-semibold" htmlFor="cargo">Cargo length in inches<input id="cargo" name="cargo" inputMode="numeric" required defaultValue={existing.cargo ?? ""} className={controlClass} /></label>
          {existing.vehiclePhoto ? <p className="text-base text-ink">Your vehicle photo is already on file.</p> : null}
          <UploadPicker id="vehicle-photo" accept="image/jpeg,image/png,image/webp" required label="Add a vehicle photo" kinds="JPG, PNG, or WEBP" clearAfter onChange={(files) => void onFile("vehicle", files?.[0] ?? null)} />
          <Submit pending={pending} label="Save vehicle" />
        </form>
      ) : null}
      {step === "equipment" ? (
        <form action={saveKit} className="space-y-3">
          {["blankets", "straps", "dolly", "ramp"].map((item) => (
            <label key={item} className="flex min-h-12 items-center gap-3 capitalize">
              <input type="checkbox" name="equipment" value={item} defaultChecked={existing.equipment.includes(item)} />
              {item}
            </label>
          ))}
          <label className="block font-semibold" htmlFor="helper">Helper name, if you have one<input id="helper" name="helper" defaultValue={existing.helperName ?? ""} className={controlClass} /></label>
          <label className="block font-semibold" htmlFor="helperPhone">Helper phone<input id="helperPhone" name="helperPhone" placeholder="+14045551212" className={controlClass} /></label>
          <Submit pending={false} label="Save equipment" />
        </form>
      ) : null}
      {step === "services" ? (
        <form action={saveServices} className="space-y-3">
          <CoverageEditor value={existing.coverage} persist onChange={() => undefined} />
          {[
            ["delivery", "Pickup and delivery"],
            ["junk", "Junk removal"],
            ["free_item", "Free-item pickup"],
            ["construction", "Construction materials"],
          ].map(([value, label]) => (
            <label key={value} className="flex min-h-12 items-center gap-3">
              <input type="checkbox" name="service" value={value} defaultChecked={existing.services.includes(value)} />
              {label}
            </label>
          ))}
          <label className="flex min-h-12 items-center gap-3">
            <input type="radio" name="level" value="light" defaultChecked={existing.serviceLevel !== "full"} />
            Light load
          </label>
          <label className="flex min-h-12 items-center gap-3">
            <input type="radio" name="level" value="full" defaultChecked={existing.serviceLevel === "full"} />
            Full service
          </label>
          <Submit pending={false} label="Save services" />
        </form>
      ) : null}
      {step === "agreement" ? (
        <form action={signAgreement} className="space-y-4">
          <p>
            Type your full name to sign. You are an independent driver. You follow the locked price, photograph pickup and drop-off, and refuse prohibited items. Read the{" "}
            <Link href="/terms" className="font-semibold text-brand">Terms of Service</Link> and{" "}
            <Link href="/privacy" className="font-semibold text-brand">Privacy Policy</Link>.
          </p>
          <label className="block font-semibold" htmlFor="signature">
            Signature
            <input id="signature" name="signature" required defaultValue={existing.fullName ?? ""} className={controlClass} />
          </label>
          <Submit pending={false} label="Sign agreement" />
        </form>
      ) : null}
      {step === "training" ? (
        <form action={completeTraining} className="space-y-4">
          <ol className="list-decimal space-y-3 pl-5">
            <li>The street address appears only after you are assigned.</li>
            <li>Photograph the item at pickup and again at drop-off.</li>
            <li>If the item does not match, stop and tell the customer in the app.</li>
            <li>Use blankets and straps. Do not haul prohibited items.</li>
            <li>If the seller does not show, mark the problem in the app.</li>
          </ol>
          <Submit pending={false} label="I finished the training" />
        </form>
      ) : null}
    </div>
  );
}

function Submit({ pending, label }: { pending: boolean; label: string }) {
  return (
    <button type="submit" disabled={pending} aria-busy={pending} className="inline-flex min-h-12 items-center justify-center rounded-full bg-brand px-6 font-semibold text-white disabled:opacity-60">
      {pending ? "Saving..." : label}
    </button>
  );
}
