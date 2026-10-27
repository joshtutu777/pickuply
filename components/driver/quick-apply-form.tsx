"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, CheckCircle, Map, MapPin, Truck, Upload } from "lucide-react";
import { CoverageEditor } from "@/components/driver/coverage-editor";
import { emptyPlace, PlaceField, type PlaceValue } from "@/components/maps/place-field";
import { TextField } from "@/components/request/fields";
import { UploadPicker } from "@/components/upload-picker";
import { saveDriverPlace } from "@/lib/maps/save-places";
import { manualAddressError } from "@/lib/maps/address";
import { defaultCoverage, type CoverageDraft } from "@/lib/driver/coverage";
import { validateFullName } from "@/lib/auth/name";
import { driverApplyEmailError } from "@/lib/validation/email";
import { recordFunnel } from "@/lib/funnel";
import { createClient } from "@/lib/supabase/client";
import { compressImage } from "@/lib/photos";

const vehicles = [
  { id: "pickup", label: "Pickup" },
  { id: "van", label: "Van" },
  { id: "suv", label: "SUV" },
  { id: "car", label: "Car" },
  { id: "box_truck", label: "Box truck" },
  { id: "trailer", label: "Trailer" },
] as const;

const controlClass =
  "mt-2 min-h-12 w-full rounded-2xl border border-line bg-paper-raised px-4 text-base text-ink";

async function uploadDoc(userId: string, name: "profile" | "license", file: File): Promise<string> {
  if (file.size > 5 * 1024 * 1024) throw new Error("Each photo must be 5 MB or smaller.");
  const prepared = await compressImage(file);
  const path = `${userId}/${name}.jpg`;
  const supabase = createClient();
  const { error } = await supabase.storage.from("driver-docs").upload(path, prepared, {
    upsert: true,
    contentType: "image/jpeg",
  });
  if (error) throw new Error("We couldn't upload that photo. Try again.");
  return path;
}

export function QuickApplyForm({
  userId,
  defaultName = "",
  defaultEmail = "",
}: {
  userId: string;
  defaultName?: string;
  defaultEmail?: string;
}) {
  const router = useRouter();
  const [fullName, setFullName] = useState(defaultName);
  const [email, setEmail] = useState(defaultEmail);
  const [home, setHome] = useState<PlaceValue>(emptyPlace);
  const [coverage, setCoverage] = useState<CoverageDraft>(defaultCoverage);
  const [vehicleType, setVehicleType] = useState("pickup");
  const [serviceLevel, setServiceLevel] = useState("light");
  const [licenseExpires, setLicenseExpires] = useState("");
  const [contactOk, setContactOk] = useState(false);
  const [termsOk, setTermsOk] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [profileFile, setProfileFile] = useState<File | null>(null);
  const [licenseFile, setLicenseFile] = useState<File | null>(null);
  const [profilePreview, setProfilePreview] = useState<string | null>(null);
  const [licensePreview, setLicensePreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  useEffect(() => {
    void recordFunnel({ event: "driver_apply_started", step: "apply" });
  }, []);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!validateFullName(fullName)) {
      setError("Enter your full name.");
      return;
    }
    const emailProblem = driverApplyEmailError(email);
    if (emailProblem) {
      setError(emailProblem);
      return;
    }
    const addressError = manualAddressError(home);
    if (addressError) {
      setError(addressError);
      return;
    }
    if (coverage.cities.length === 0 && coverage.zips.length === 0 && coverage.radius == null) {
      setError("Choose at least one area you cover.");
      return;
    }
    if (!profileFile || !licenseFile) {
      setError("Add a profile photo and a photo of your license.");
      return;
    }
    if (!contactOk) {
      setError("Agree to be contacted about this application.");
      return;
    }
    if (!termsOk) {
      setError("Agree to the Pickuply Driver Terms.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      setProgress("Uploading profile photo");
      const photoPath = await uploadDoc(userId, "profile", profileFile);
      setProgress("Uploading license photo");
      const licensePath = await uploadDoc(userId, "license", licenseFile);
      setProgress("Saving application");
      const { error: saveError } = await createClient().rpc("submit_quick_application", {
        payload: {
          full_name: fullName.trim(),
          email: email.trim(),
          home_city: home.city.trim(),
          home_zip: home.zip.trim(),
          coverage: {
            cities: coverage.cities,
            zips: coverage.zips,
            radius: coverage.radius,
            radius_zip: coverage.radius && coverage.radiusZip ? coverage.radiusZip : null,
          },
          vehicle_type: vehicleType,
          service_level: serviceLevel,
          photo_path: photoPath,
          license_path: licensePath,
          license_expires: licenseExpires,
          contact_ok: "true",
          terms_ok: "true",
        },
      });
      if (saveError) throw new Error(saveError.message);
      const placeError = await saveDriverPlace(home);
      if (placeError) throw new Error(placeError);
      void recordFunnel({ event: "driver_submitted", step: "submitted" });
      router.push("/driver?saved=applied");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "We couldn't submit the application.");
      setProgress(null);
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="mt-6 space-y-4">
      <TextField name="fullName" label="Your name" value={fullName} onChange={setFullName} autoComplete="name" />
      <TextField
        name="driverEmail"
        label="Email address"
        type="email"
        inputMode="email"
        autoComplete="email"
        required
        hint="For booking updates and receipts."
        value={email}
        onChange={setEmail}
      />
      <div className="flex items-center gap-2 text-base font-semibold text-ink">
        <MapPin aria-hidden="true" className="size-5 text-brand" />
        Home address
      </div>
      <PlaceField label="Home address" value={home} onChange={setHome} />
      <fieldset className="space-y-3 rounded-3xl bg-paper-raised p-4 ring-1 ring-line">
        <legend className="flex items-center gap-2 text-base font-semibold text-ink">
          <Map aria-hidden="true" className="size-5 text-brand" />
          Areas I cover
        </legend>
        <CoverageEditor value={coverage} onChange={setCoverage} />
      </fieldset>
      <label className="block text-base font-semibold text-ink" htmlFor="vehicleType">
        <span className="inline-flex items-center gap-2">
          <Truck aria-hidden="true" className="size-5 text-brand" />
          Vehicle type
        </span>
        <select id="vehicleType" className={controlClass} value={vehicleType} onChange={(event) => setVehicleType(event.target.value)}>
          {vehicles.map((vehicle) => (
            <option key={vehicle.id} value={vehicle.id}>
              {vehicle.label}
            </option>
          ))}
        </select>
      </label>
      <fieldset>
        <legend className="text-base font-semibold text-ink">What can you haul?</legend>
        <label className="mt-2 flex min-h-12 items-center gap-3">
          <input type="radio" name="serviceLevel" value="light" checked={serviceLevel === "light"} onChange={() => setServiceLevel("light")} />
          Light load
        </label>
        <label className="flex min-h-12 items-center gap-3">
          <input type="radio" name="serviceLevel" value="full" checked={serviceLevel === "full"} onChange={() => setServiceLevel("full")} />
          Full service
        </label>
      </fieldset>
      <UploadPicker
        id="profilePhoto"
        accept="image/jpeg,image/png,image/webp"
        required
        label="Add a profile photo"
        kinds="JPG, PNG, or WEBP"
        clearAfter
        onChange={(files) => {
          const file = files?.[0] ?? null;
          setProfileFile(file);
          setProfilePreview((current) => {
            if (current) URL.revokeObjectURL(current);
            return file ? URL.createObjectURL(file) : null;
          });
        }}
      />
      {profilePreview ? (
        // Local preview of a file that has not been uploaded yet.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={profilePreview} alt="" className="h-24 w-24 rounded-2xl object-cover" />
      ) : null}
      <UploadPicker
        id="licensePhoto"
        accept="image/jpeg,image/png,image/webp"
        required
        label="Add your license photo"
        kinds="JPG, PNG, or WEBP"
        clearAfter
        onChange={(files) => {
          const file = files?.[0] ?? null;
          setLicenseFile(file);
          setLicensePreview((current) => {
            if (current) URL.revokeObjectURL(current);
            return file ? URL.createObjectURL(file) : null;
          });
        }}
      />
      {licensePreview ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={licensePreview} alt="" className="h-24 w-24 rounded-2xl object-cover" />
      ) : null}
      <label className="block text-base font-semibold text-ink" htmlFor="licenseExpires">
        License expiration
        <input id="licenseExpires" type="date" required value={licenseExpires} onChange={(event) => setLicenseExpires(event.target.value)} className={controlClass} />
      </label>
      <label className="flex min-h-12 items-start gap-3 text-base">
        <input type="checkbox" checked={contactOk} onChange={(event) => setContactOk(event.target.checked)} />
        Pickuply can contact me about this application.
      </label>
      <label className="flex min-h-12 items-start gap-3 text-base">
        <input type="checkbox" checked={termsOk} onChange={(event) => setTermsOk(event.target.checked)} />
        <span>
          I agree to the <Link href="/terms/driver" className="font-semibold text-brand">Pickuply Driver Terms</Link>.
        </span>
      </label>
      {progress ? (
        <p className="inline-flex items-center gap-2 text-base text-ink">
          <Upload aria-hidden="true" className="size-5 text-brand" />
          {progress}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="inline-flex items-center gap-2 text-base text-danger">
          <AlertCircle aria-hidden="true" className="size-5" />
          {error}
        </p>
      ) : null}
      {termsOk && contactOk && profileFile && licenseFile ? (
        <p className="inline-flex items-center gap-2 text-sm text-muted">
          <CheckCircle aria-hidden="true" className="size-5 text-brand" />
          Required photos and terms are ready.
        </p>
      ) : null}
      <button type="submit" disabled={pending} className="inline-flex min-h-12 items-center justify-center rounded-full bg-brand px-6 font-semibold text-white">
        Submit application
      </button>
    </form>
  );
}
