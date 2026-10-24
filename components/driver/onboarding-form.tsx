"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { TextField } from "@/components/request/fields";
import { SmsConsent, recordOptionalSmsConsent } from "@/components/sms-consent";
import { validateFullName } from "@/lib/auth/name";
import { createClient } from "@/lib/supabase/client";

const services = [
  { id: "delivery", label: "Pickup and delivery" },
  { id: "junk", label: "Junk removal" },
  { id: "free_item", label: "Free-item pickup" },
  { id: "construction", label: "Construction materials" },
] as const;

const equipmentOptions = [
  { id: "blankets", label: "Blankets" },
  { id: "straps", label: "Straps" },
  { id: "dolly", label: "Dolly" },
  { id: "ramp", label: "Ramp" },
] as const;

const vehicles = [
  { id: "car", label: "Car" },
  { id: "suv", label: "SUV" },
  { id: "pickup", label: "Pickup" },
  { id: "van", label: "Van" },
  { id: "box_truck", label: "Box truck" },
  { id: "trailer", label: "Trailer" },
] as const;

export type OnboardingZone = { id: string; name: string };

const controlClass =
  "mt-2 min-h-12 w-full rounded-2xl border border-line bg-paper-raised px-4 text-base text-ink";

async function uploadDoc(
  userId: string,
  name: "profile" | "license" | "insurance" | "vehicle",
  file: File,
): Promise<string> {
  if (file.size > 5 * 1024 * 1024) {
    throw new Error("Each photo must be 5 MB or smaller.");
  }
  const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const path = `${userId}/${name}.${ext}`;
  const supabase = createClient();
  const { error } = await supabase.storage.from("driver-docs").upload(path, file, {
    upsert: true,
    contentType: file.type || "image/jpeg",
  });
  if (error) throw new Error("We couldn't upload that photo. Try again.");
  return path;
}

export function OnboardingForm({
  userId,
  zones,
  reviewNote,
}: {
  userId: string;
  zones: OnboardingZone[];
  reviewNote: string | null;
}) {
  const router = useRouter();
  const [fullName, setFullName] = useState("");
  const [homeCity, setHomeCity] = useState("");
  const [zoneId, setZoneId] = useState(zones[0]?.id ?? "");
  const [miles, setMiles] = useState("25");
  const [vehicleType, setVehicleType] = useState("pickup");
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [year, setYear] = useState("");
  const [plate, setPlate] = useState("");
  const [cargo, setCargo] = useState("");
  const [serviceLevel, setServiceLevel] = useState("light");
  const [helperName, setHelperName] = useState("");
  const [helperPhone, setHelperPhone] = useState("");
  const [chosenServices, setChosenServices] = useState<string[]>(["delivery"]);
  const [equipment, setEquipment] = useState<string[]>([]);
  const [licenseExpires, setLicenseExpires] = useState("");
  const [insuranceExpires, setInsuranceExpires] = useState("");
  const [payoutMethod, setPayoutMethod] = useState("zelle");
  const [smsOptIn, setSmsOptIn] = useState(false);
  const [payoutHandle, setPayoutHandle] = useState("");
  const [agreements, setAgreements] = useState<string[]>([]);
  const [signature, setSignature] = useState("");
  const [profileFile, setProfileFile] = useState<File | null>(null);
  const [licenseFile, setLicenseFile] = useState<File | null>(null);
  const [insuranceFile, setInsuranceFile] = useState<File | null>(null);
  const [vehicleFile, setVehicleFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function toggle(list: string[], id: string, setter: (next: string[]) => void) {
    setter(list.includes(id) ? list.filter((item) => item !== id) : [...list, id]);
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const name = validateFullName(fullName);
    if (!name) {
      setError("Enter your full name using letters, spaces, apostrophes, periods, or hyphens.");
      return;
    }
    if (!profileFile || !licenseFile || !vehicleFile) {
      setError("Add a profile photo, a license photo, and a vehicle photo.");
      return;
    }
    if (signature.trim().toLowerCase() !== name.toLowerCase()) {
      setError("Type your full name to sign the agreement.");
      return;
    }
    setPending(true);
    try {
      const [photoPath, licensePath, vehiclePath] = await Promise.all([
        uploadDoc(userId, "profile", profileFile),
        uploadDoc(userId, "license", licenseFile),
        uploadDoc(userId, "vehicle", vehicleFile),
      ]);
      const insurancePath = insuranceFile ? await uploadDoc(userId, "insurance", insuranceFile) : "";
      const supabase = createClient();
      const { error: saveError } = await supabase.rpc("submit_driver_application", {
        payload: {
          full_name: name,
          photo_path: photoPath,
          home_city: homeCity,
          zone_id: zoneId,
          max_distance_miles: Number(miles),
          vehicle_type: vehicleType,
          make,
          model,
          year: Number(year),
          plate,
          cargo_length_in: Number(cargo),
          vehicle_photo_path: vehiclePath,
          service_level: serviceLevel,
          helper_name: helperName,
          helper_phone: helperPhone,
          equipment,
          services: chosenServices,
          license_path: licensePath,
          license_expires: licenseExpires,
          insurance_path: insurancePath,
          insurance_expires: insuranceExpires,
          payout_method: payoutMethod,
          payout_handle: payoutHandle,
          agreements,
          signature: signature.trim(),
        },
      });
      if (saveError) {
        setError(saveError.message);
        setPending(false);
        return;
      }
      if (smsOptIn) {
        const consentError = await recordOptionalSmsConsent("driver_onboarding");
        if (consentError) {
          setError(
            "Your application was saved. We couldn't save your text-message choice, so optional texts stay off.",
          );
          setPending(false);
          return;
        }
      }
      router.push("/driver/onboarding?submitted=1");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "We couldn't save your application.");
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="mt-8 space-y-8">
      {reviewNote ? (
        <p className="rounded-2xl bg-paper-raised p-4 text-base leading-relaxed text-ink ring-1 ring-line">
          Pickuply asked for a change: {reviewNote}
        </p>
      ) : null}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-ink">About you</h2>
        <TextField label="Full name" name="fullName" value={fullName} onChange={setFullName} autoComplete="name" />
        <label className="block text-base font-semibold text-ink">
          Profile photo
          <input
            className="mt-2 block w-full text-base"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={(event) => setProfileFile(event.target.files?.[0] ?? null)}
          />
        </label>
        <TextField label="Home city" name="homeCity" value={homeCity} onChange={setHomeCity} />
        <label className="block text-base font-semibold text-ink" htmlFor="zone">
          Service area
          <select id="zone" className={controlClass} value={zoneId} onChange={(event) => setZoneId(event.target.value)}>
            {zones.map((zone) => (
              <option key={zone.id} value={zone.id}>
                {zone.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-base font-semibold text-ink" htmlFor="miles">
          How far you will drive
          <select id="miles" className={controlClass} value={miles} onChange={(event) => setMiles(event.target.value)}>
            <option value="10">10 miles</option>
            <option value="15">15 miles</option>
            <option value="25">25 miles</option>
          </select>
        </label>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-ink">Vehicle</h2>
        <label className="block text-base font-semibold text-ink" htmlFor="vehicleType">
          Type
          <select
            id="vehicleType"
            className={controlClass}
            value={vehicleType}
            onChange={(event) => setVehicleType(event.target.value)}
          >
            {vehicles.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <TextField label="Make" name="make" value={make} onChange={setMake} />
        <TextField label="Model" name="model" value={model} onChange={setModel} />
        <TextField label="Year" name="year" value={year} onChange={setYear} inputMode="numeric" />
        <TextField label="Plate" name="plate" value={plate} onChange={setPlate} />
        <TextField
          label="Cargo length (inches)"
          name="cargo"
          value={cargo}
          onChange={setCargo}
          inputMode="numeric"
        />
        <label className="block text-base font-semibold text-ink">
          Vehicle photo
          <input
            className="mt-2 block w-full text-base"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={(event) => setVehicleFile(event.target.files?.[0] ?? null)}
          />
        </label>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-ink">What you can haul</h2>
        <fieldset>
          <legend className="text-base font-semibold text-ink">Service level</legend>
          <label className="mt-3 flex min-h-12 items-center gap-3 text-base">
            <input
              type="radio"
              name="serviceLevel"
              checked={serviceLevel === "light"}
              onChange={() => setServiceLevel("light")}
            />
            Light — no heavy lifting and no stairs
          </label>
          <label className="mt-2 flex min-h-12 items-center gap-3 text-base">
            <input
              type="radio"
              name="serviceLevel"
              checked={serviceLevel === "full"}
              onChange={() => setServiceLevel("full")}
            />
            Full — heavy items and stairs
          </label>
        </fieldset>
        <TextField label="Helper name" name="helperName" value={helperName} onChange={setHelperName} optional />
        <TextField label="Helper phone" name="helperPhone" value={helperPhone} onChange={setHelperPhone} optional type="tel" />
        <fieldset>
          <legend className="text-base font-semibold text-ink">Equipment</legend>
          {equipmentOptions.map((item) => (
            <label key={item.id} className="mt-2 flex min-h-12 items-center gap-3 text-base">
              <input
                type="checkbox"
                checked={equipment.includes(item.id)}
                onChange={() => toggle(equipment, item.id, setEquipment)}
              />
              {item.label}
            </label>
          ))}
        </fieldset>
        <fieldset>
          <legend className="text-base font-semibold text-ink">Services</legend>
          {services.map((item) => (
            <label key={item.id} className="mt-2 flex min-h-12 items-center gap-3 text-base">
              <input
                type="checkbox"
                checked={chosenServices.includes(item.id)}
                onChange={() => toggle(chosenServices, item.id, setChosenServices)}
              />
              {item.label}
            </label>
          ))}
        </fieldset>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-ink">Documents and payout</h2>
        <label className="block text-base font-semibold text-ink">
          Driver license photo
          <input
            className="mt-2 block w-full text-base"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={(event) => setLicenseFile(event.target.files?.[0] ?? null)}
          />
        </label>
        <TextField
          label="License expiration"
          name="licenseExpires"
          type="date"
          value={licenseExpires}
          onChange={setLicenseExpires}
        />
        <label className="block text-base font-semibold text-ink">
          Insurance proof
          <span className="mt-1 block font-normal text-muted">
            You can add this later. It is required before you go Online.
          </span>
          <input
            className="mt-2 block w-full text-base"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={(event) => setInsuranceFile(event.target.files?.[0] ?? null)}
          />
        </label>
        <TextField
          label="Insurance expiration"
          name="insuranceExpires"
          type="date"
          value={insuranceExpires}
          onChange={setInsuranceExpires}
          optional
        />
        <label className="block text-base font-semibold text-ink" htmlFor="payout">
          How we pay you
          <select
            id="payout"
            className={controlClass}
            value={payoutMethod}
            onChange={(event) => setPayoutMethod(event.target.value)}
          >
            <option value="zelle">Zelle</option>
            <option value="cash_app">Cash App</option>
          </select>
        </label>
        <TextField label="Zelle or Cash App handle" name="payoutHandle" value={payoutHandle} onChange={setPayoutHandle} />
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold text-ink">Driver agreement</h2>
        {[
          ["independent", "I am an independent contractor, not an employee of Pickuply."],
          ["rules", "I will follow the locked price, photograph pickup and drop-off, and refuse prohibited items."],
          ["accurate", "The documents and vehicle details I submit are accurate."],
          ["payout", "Pay me at the Zelle or Cash App handle above. I will not take payment from the customer."],
        ].map(([id, label]) => (
          <label key={id} className="flex min-h-12 items-start gap-3 text-base leading-relaxed">
            <input
              className="mt-1"
              type="checkbox"
              checked={agreements.includes(id)}
              onChange={() => toggle(agreements, id, setAgreements)}
            />
            {label}
          </label>
        ))}
        <TextField
          label="Type your full name to sign"
          name="signature"
          value={signature}
          onChange={setSignature}
        />
      </section>

      <SmsConsent audience="driver" checked={smsOptIn} onChange={setSmsOptIn} />
      {error ? (
        <p role="alert" className="text-base font-medium text-danger">
          {error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="inline-flex min-h-12 w-full items-center justify-center rounded-full bg-brand px-6 text-base font-semibold text-white disabled:opacity-60"
      >
        {pending ? "Saving…" : "Submit application"}
      </button>
    </form>
  );
}
