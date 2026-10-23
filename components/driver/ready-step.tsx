"use client";

import { useState, type FormEvent } from "react";
import {
  completeTraining,
  saveInsurance,
  saveKit,
  saveServices,
  saveVehicle,
  signAgreement,
} from "@/app/driver/ready/actions";
import { createClient } from "@/lib/supabase/client";

const controlClass =
  "mt-2 min-h-12 w-full rounded-2xl border border-line bg-paper-raised px-4 text-base text-ink";

async function upload(userId: string, name: "insurance" | "vehicle", file: File): Promise<string> {
  if (file.size > 5 * 1024 * 1024) throw new Error("Each photo must be 5 MB or smaller.");
  const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const path = `${userId}/${name}.${ext}`;
  const { error } = await createClient().storage.from("driver-docs").upload(path, file, {
    upsert: true,
    contentType: file.type || "image/jpeg",
  });
  if (error) throw new Error("We couldn't upload that photo. Try again.");
  return path;
}

export function ReadyStep({
  step,
  userId,
  error,
}: {
  step: string;
  userId: string;
  error?: string;
}) {
  const [photoError, setPhotoError] = useState("");
  const [path, setPath] = useState("");
  const [pending, setPending] = useState(false);

  async function onFile(name: "insurance" | "vehicle", file: File | null) {
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
    if (!path) {
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
      {step === "insurance" ? (
        <form action={saveInsurance} className="space-y-4" onSubmit={requirePhoto}>
          <input type="hidden" name="path" value={path} />
          <label className="block font-semibold" htmlFor="insurance-photo">
            Insurance photo
            <input id="insurance-photo" type="file" accept="image/*" className="mt-2 block w-full" onChange={(event) => void onFile("insurance", event.target.files?.[0] ?? null)} />
          </label>
          <label className="block font-semibold" htmlFor="insurance-expires">
            Insurance expiration
            <input id="insurance-expires" name="expires" type="date" required className={controlClass} />
          </label>
          <Submit pending={pending || !path} label="Save insurance" />
        </form>
      ) : null}
      {step === "vehicle" ? (
        <form action={saveVehicle} className="space-y-4" onSubmit={requirePhoto}>
          <input type="hidden" name="path" value={path} />
          <label className="block font-semibold" htmlFor="make">Make<input id="make" name="make" required className={controlClass} /></label>
          <label className="block font-semibold" htmlFor="model">Model<input id="model" name="model" required className={controlClass} /></label>
          <label className="block font-semibold" htmlFor="year">Year<input id="year" name="year" inputMode="numeric" required className={controlClass} /></label>
          <label className="block font-semibold" htmlFor="plate">Plate<input id="plate" name="plate" required className={controlClass} /></label>
          <label className="block font-semibold" htmlFor="cargo">Cargo length in inches<input id="cargo" name="cargo" inputMode="numeric" required className={controlClass} /></label>
          <label className="block font-semibold" htmlFor="vehicle-photo">
            Vehicle photo
            <input id="vehicle-photo" type="file" accept="image/*" className="mt-2 block w-full" onChange={(event) => void onFile("vehicle", event.target.files?.[0] ?? null)} />
          </label>
          <Submit pending={pending || !path} label="Save vehicle" />
        </form>
      ) : null}
      {step === "equipment" ? (
        <form action={saveKit} className="space-y-3">
          {["blankets", "straps", "dolly", "ramp"].map((item) => (
            <label key={item} className="flex min-h-12 items-center gap-3 capitalize">
              <input type="checkbox" name="equipment" value={item} />
              {item}
            </label>
          ))}
          <label className="block font-semibold" htmlFor="helper">Helper name, if you have one<input id="helper" name="helper" className={controlClass} /></label>
          <label className="block font-semibold" htmlFor="helperPhone">Helper phone<input id="helperPhone" name="helperPhone" placeholder="+14045551212" className={controlClass} /></label>
          <Submit pending={false} label="Save equipment" />
        </form>
      ) : null}
      {step === "services" ? (
        <form action={saveServices} className="space-y-3">
          {[
            ["delivery", "Pickup and delivery"],
            ["junk", "Junk removal"],
            ["free_item", "Free-item pickup"],
            ["construction", "Construction materials"],
          ].map(([value, label]) => (
            <label key={value} className="flex min-h-12 items-center gap-3">
              <input type="checkbox" name="service" value={value} />
              {label}
            </label>
          ))}
          <label className="flex min-h-12 items-center gap-3">
            <input type="radio" name="level" value="light" defaultChecked />
            Light load
          </label>
          <label className="flex min-h-12 items-center gap-3">
            <input type="radio" name="level" value="full" />
            Full service
          </label>
          <Submit pending={false} label="Save services" />
        </form>
      ) : null}
      {step === "agreement" ? (
        <form action={signAgreement} className="space-y-4">
          <p>Type your full name to sign. You are an independent driver. You follow the locked price, photograph pickup and drop-off, and refuse prohibited items.</p>
          <label className="block font-semibold" htmlFor="signature">
            Signature
            <input id="signature" name="signature" required className={controlClass} />
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
    <button type="submit" disabled={pending} className="inline-flex min-h-12 items-center justify-center rounded-full bg-brand px-6 font-semibold text-white">
      {label}
    </button>
  );
}
