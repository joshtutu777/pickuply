"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  fees,
  itemSizes,
  junkLoadSizes,
  maxPhotos,
  driverPricingCopy,
  pricingMethods,
  quotePricingCopy,
  privacyAreaNote,
  requestSteps,
  serviceById,
  services,
  stairChoices,
  timeWindows,
  type RequestStepId,
  type ServiceId,
} from "@/lib/constants";
import { TripPreview } from "@/components/maps/area-map";
import { AddressLookup } from "@/components/maps/place-field";
import { createRequest, clearSubmissionId, RequestSubmitError } from "@/lib/data/requests";
import { addDays, localDateISO } from "@/lib/dates";
import { clearStoredDraft, loadStoredDraft, saveStoredDraft } from "@/lib/draft";
import { estimateForDraft, estimateMessage } from "@/lib/estimate";
import { recordFunnel } from "@/lib/funnel";
import { formatCents, parseDollarsToCents } from "@/lib/money";
import { mapOtpError, otpErrorCopy } from "@/lib/auth/otp-errors";
import { codeSentMessage, normalizeUsPhone } from "@/lib/phone";
import { deletePhoto, loadPhoto, savePhoto } from "@/lib/photo-store";
import { compressImage } from "@/lib/photos";
import { createClient } from "@/lib/supabase/client";
import { emptyDraft, type RequestDraft } from "@/lib/types";
import { validateStep, valueWarning, type FieldErrors } from "@/lib/validation/request";
import { CheckField, RadioCards, TextAreaField, TextField, YesNo } from "./fields";

type Preview = { id: string; url: string };

const primaryButton =
  "inline-flex min-h-14 flex-1 items-center justify-center rounded-full bg-brand px-6 text-lg font-semibold text-white hover:bg-brand-dark disabled:opacity-60";
const secondaryButton =
  "inline-flex min-h-14 items-center justify-center rounded-full border border-line bg-paper-raised px-5 text-base font-semibold text-ink";

type Boot = {
  draft: RequestDraft;
  photoIds: string[];
  showResume: boolean;
  formError: string | null;
};

function loadBoot(initialService: ServiceId | null): Boot {
  const blank = emptyDraft(initialService ?? "");
  try {
    const stored = loadStoredDraft();
    if (stored && (stored.draft.service || stored.draft.description || stored.photoIds.length > 0)) {
      return {
        draft: { ...emptyDraft(), ...stored.draft },
        photoIds: stored.photoIds,
        showResume: true,
        formError: null,
      };
    }
  } catch {
    return {
      draft: blank,
      photoIds: [],
      showResume: false,
      formError: "This browser couldn't open a saved draft.",
    };
  }
  return { draft: blank, photoIds: [], showResume: false, formError: null };
}

function focusField(errors: FieldErrors) {
  const name = Object.keys(errors)[0];
  if (!name) return;
  const field = document.querySelector<HTMLElement>(`[name="${name}"]`);
  field?.focus();
}

export function RequestWizard({ initialService }: { initialService: ServiceId | null }) {
  const [boot] = useState(() => loadBoot(initialService));
  const [showResume, setShowResume] = useState(boot.showResume);
  const [draft, setDraft] = useState<RequestDraft>(boot.draft);
  const [photoIds, setPhotoIds] = useState<string[]>(boot.photoIds);
  const photoIdsRef = useRef(photoIds);
  const [previews, setPreviews] = useState<Preview[]>([]);
  const [stepIndex, setStepIndex] = useState(0);
  const funnelStarted = useRef(false);
  useEffect(() => {
    const service = draft.service || null;
    const pricing = draft.pricingMethod || null;
    if (!funnelStarted.current) {
      funnelStarted.current = true;
      void recordFunnel({ event: "request_started", step: "1", service, pricing });
      return;
    }
    if (stepIndex >= requestSteps.length) {
      void recordFunnel({ event: "request_verified", step: "verified", service, pricing });
      return;
    }
    void recordFunnel({ event: "request_screen", step: String(stepIndex + 1), service, pricing });
  }, [draft.pricingMethod, draft.service, stepIndex]);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(boot.formError);
  const [submitting, setSubmitting] = useState(false);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [codeSent, setCodeSent] = useState(false);
  const [code, setCode] = useState("");
  const [otpError, setOtpError] = useState("");
  const [photoProgress, setPhotoProgress] = useState<Record<string, string>>({});
  const [missingPhotos, setMissingPhotos] = useState<string[]>([]);
  const [sentId, setSentId] = useState<string | null>(null);

  useEffect(() => {
    const ids = boot.photoIds;
    if (ids.length === 0) return;
    let cancelled = false;
    const urls: string[] = [];
    void (async () => {
      const next: Preview[] = [];
      for (const id of ids) {
        try {
          const blob = await loadPhoto(id);
          if (!blob || cancelled) continue;
          const url = URL.createObjectURL(blob);
          urls.push(url);
          next.push({ id, url });
        } catch {
          // A missing photo should not block the rest of the draft.
        }
      }
      if (!cancelled) setPreviews(next);
    })();
    return () => {
      cancelled = true;
      for (const url of urls) URL.revokeObjectURL(url);
    };
  }, [boot.photoIds]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const supabase = createClient();
        const { data } = await supabase.auth.getUser();
        if (cancelled) return;
        if (!data.user) {
          setSignedIn(false);
          return;
        }
        setSignedIn(true);
        const profile = await supabase
          .from("profiles")
          .select("full_name, phone")
          .eq("id", data.user.id)
          .maybeSingle();
        if (cancelled || profile.error || !profile.data) return;
        setDraft((current) => ({
          ...current,
          customerName: current.customerName || profile.data?.full_name || "",
          customerPhone: current.customerPhone || profile.data?.phone || "",
        }));
      } catch {
        if (!cancelled) setSignedIn(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function persist(nextDraft: RequestDraft, nextPhotoIds: string[]) {
    try {
      saveStoredDraft(nextDraft, nextPhotoIds);
    } catch {
      setFormError("This browser couldn't save a draft of this request.");
    }
  }

  function update<K extends keyof RequestDraft>(key: K, value: RequestDraft[K]) {
    photoIdsRef.current = photoIds;
    setDraft((current) => {
      const next = { ...current, [key]: value };
      if (key === "service" && value === "free_item" && !current.preferredDate) {
        next.preferredDate = "asap";
      }
      if (key === "preferredDate" && value === "asap") next.timeWindow = "";
      if (!showResume) persist(next, photoIdsRef.current);
      return next;
    });
    setErrors((current) => ({ ...current, [key]: undefined }));
  }

  function goToStep(id: RequestStepId) {
    const index = requestSteps.findIndex((step) => step.id === id);
    if (index >= 0) {
      setStepIndex(index);
      setErrors({});
    }
  }

  async function startOver() {
    await Promise.all(photoIds.map((id) => deletePhoto(id).catch(() => undefined)));
    for (const preview of previews) URL.revokeObjectURL(preview.url);
    clearStoredDraft();
    clearSubmissionId();
    setDraft(emptyDraft(initialService ?? ""));
    setPhotoIds([]);
    setPreviews([]);
    setStepIndex(0);
    setErrors({});
    setShowResume(false);
    setPhotoError(null);
  }

  async function addPhotos(list: FileList | null) {
    if (!list?.length) return;
    const room = maxPhotos - photoIds.length;
    if (room <= 0 || list.length > room) {
      setPhotoError(`You can add up to ${maxPhotos} photos.`);
    }
    const files = [...list].slice(0, Math.max(room, 0));
    const added: Preview[] = [];
    for (const file of files) {
      try {
        const blob = await compressImage(file);
        const id = crypto.randomUUID();
        await savePhoto(id, blob);
        added.push({ id, url: URL.createObjectURL(blob) });
      } catch (error) {
        setPhotoError(
          error instanceof Error ? error.message : "This photo couldn't be prepared. Try a JPEG or PNG.",
        );
      }
    }
    if (added.length) {
      setPhotoError(null);
      const nextIds = [...photoIds, ...added.map((item) => item.id)];
      setPhotoIds(nextIds);
      setPreviews((items) => [...items, ...added]);
      persist(draft, nextIds);
    }
  }

  function removePhoto(id: string) {
    const nextIds = photoIds.filter((item) => item !== id);
    setPhotoIds(nextIds);
    setPreviews((items) => {
      const match = items.find((item) => item.id === id);
      if (match) URL.revokeObjectURL(match.url);
      return items.filter((item) => item.id !== id);
    });
    persist(draft, nextIds);
    void deletePhoto(id).catch(() => undefined);
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (stepIndex >= requestSteps.length) {
      if (signedIn) void saveRequest();
      else if (codeSent) void verifyCode();
      else void sendCode();
      return;
    }
    const step = requestSteps[stepIndex];
    const options = { photoCount: photoIds.length, signedIn: signedIn === true };
    if (step.id === "verify") {
      const firstInvalid = requestSteps.findIndex(
        (item) => Object.keys(validateStep(item.id, draft, options)).length > 0,
      );
      if (firstInvalid >= 0) {
        setStepIndex(firstInvalid);
        const stepErrors = validateStep(requestSteps[firstInvalid].id, draft, options);
        setErrors(stepErrors);
        focusField(stepErrors);
        return;
      }
      setErrors({});
      if (signedIn) {
        void saveRequest();
        return;
      }
      setStepIndex(requestSteps.length);
      return;
    }
    const stepErrors = validateStep(step.id, draft, options);
    if (Object.keys(stepErrors).length > 0) {
      setErrors(stepErrors);
      focusField(stepErrors);
      return;
    }
    setErrors({});
    setStepIndex((index) => index + 1);
  }

  async function sendCode() {
    const phone = normalizeUsPhone(draft.customerPhone);
    if (!phone) {
      setOtpError(otpErrorCopy.invalidNumber);
      return;
    }
    setSubmitting(true);
    setOtpError("");
    try {
      const { error } = await createClient().auth.signInWithOtp({
        phone,
        options: { channel: "sms" },
      });
      if (error) {
        setOtpError(mapOtpError(error, "send"));
        return;
      }
      setCodeSent(true);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "";
      const name = caught instanceof Error ? caught.name : "";
      setOtpError(mapOtpError({ message, name }, "send"));
    } finally {
      setSubmitting(false);
    }
  }

  async function verifyCode() {
    const phone = normalizeUsPhone(draft.customerPhone);
    if (!phone || !/^\d{6}$/.test(code)) {
      setOtpError("Enter the 6-digit code.");
      return;
    }
    setSubmitting(true);
    setOtpError("");
    try {
      const { error } = await createClient().auth.verifyOtp({
        phone,
        token: code,
        type: "sms",
      });
      if (error) {
        setOtpError(mapOtpError(error, "verify"));
        setSubmitting(false);
        return;
      }
      setSignedIn(true);
      await saveRequest();
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "";
      const name = caught instanceof Error ? caught.name : "";
      setOtpError(mapOtpError({ message, name }, "verify"));
      setSubmitting(false);
    }
  }

  async function reselectPhoto(id: string, list: FileList | null) {
    const file = list?.[0];
    if (!file) return;
    try {
      const blob = await compressImage(file);
      await savePhoto(id, blob);
      setMissingPhotos((current) => current.filter((item) => item !== id));
      setPreviews((current) => [
        ...current.filter((item) => item.id !== id),
        { id, url: URL.createObjectURL(blob) },
      ]);
      setPhotoError(null);
    } catch (error) {
      setPhotoError(
        error instanceof Error ? error.message : "This photo couldn't be prepared. Try a JPEG or PNG.",
      );
    }
  }

  async function saveRequest() {
    setSubmitting(true);
    setFormError(null);
    try {
      const job = await createRequest(draft, photoIds, (photoId, state) => {
        setPhotoProgress((current) => ({ ...current, [photoId]: state }));
      });
      clearStoredDraft();
      clearSubmissionId();
      await Promise.all(photoIds.map((id) => deletePhoto(id).catch(() => undefined)));
      void recordFunnel({
        event: "request_submitted",
        step: "submitted",
        service: draft.service || null,
        pricing: draft.pricingMethod || null,
      });
      setSentId(job.id);
      setSubmitting(false);
    } catch (error) {
      if (error instanceof RequestSubmitError) {
        if (error.code === "missing-photo") setMissingPhotos(error.missingPhotoIds);
        if (error.code === "auth") setSignedIn(false);
        setFormError(error.message);
      } else {
        setFormError("We couldn't save this request. Your draft is still here.");
      }
      setSubmitting(false);
    }
  }

  if (sentId) {
    return (
      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col px-4 py-10">
        <h1 className="font-display text-4xl font-semibold tracking-tight text-ink">Request sent</h1>
        <p className="mt-4 text-lg leading-relaxed text-muted">
          We&apos;ll review this request. Nothing is booked, and drivers cannot see it until it is published.
        </p>
        <Link href={`/jobs/${sentId}`} className={`${primaryButton} mt-8`}>
          View your request
        </Link>
      </main>
    );
  }

  if (showResume) {
    return (
      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col px-4 py-10">
        <h1 className="font-display text-4xl font-semibold tracking-tight text-ink">
          Continue your request
        </h1>
        <p className="mt-4 text-lg leading-relaxed text-muted">
          Item details are still on this device. Phone, email, and street addresses need to be entered again.
        </p>
        <div className="mt-8 flex flex-col gap-3">
          <button type="button" className={primaryButton} onClick={() => setShowResume(false)}>
            Continue your request
          </button>
          <button type="button" className={secondaryButton} onClick={() => void startOver()}>
            Start over
          </button>
        </div>
      </main>
    );
  }

  const verifying = stepIndex >= requestSteps.length;
  const step = requestSteps[Math.min(stepIndex, requestSteps.length - 1)];
  const warning = valueWarning(draft);
  const today = localDateISO();

  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-4 py-6">
      {verifying ? (
        <p className="text-sm font-semibold tracking-wide text-brand uppercase">Phone verification</p>
      ) : (
        <div>
          <p className="text-sm font-semibold text-muted">
            Step {stepIndex + 1} of {requestSteps.length}
          </p>
          <div
            className="mt-2 h-2 overflow-hidden rounded-full bg-line"
            role="progressbar"
            aria-valuemin={1}
            aria-valuemax={requestSteps.length}
            aria-valuenow={stepIndex + 1}
            aria-label="Request progress"
          >
            <div
              className="h-full bg-brand"
              style={{ width: `${((stepIndex + 1) / requestSteps.length) * 100}%` }}
            />
          </div>
        </div>
      )}

      <form onSubmit={onSubmit} className="mt-6" noValidate>
        {verifying ? (
          <section className="grid gap-4">
            <h1 className="font-display text-4xl font-semibold tracking-tight text-ink">
              Confirm your phone
            </h1>
            <p className="text-lg leading-relaxed text-muted">
              {signedIn
                ? "You're signed in. Saving keeps this request on your account. It is not booked, and drivers cannot see it yet."
                : "We'll text a 6-digit code to the number on this request. The rest of the form stays on this page."}
            </p>
            {!signedIn ? (
              <>
                <label className="block" htmlFor="confirm-phone">
                  <span className="text-base font-semibold text-ink">Mobile number</span>
                  <input
                    id="confirm-phone"
                    readOnly
                    value={draft.customerPhone}
                    className="mt-2 min-h-12 w-full rounded-2xl border border-line bg-paper-raised px-4 text-base text-ink"
                  />
                </label>
                {codeSent ? (
                  <label className="block" htmlFor="confirm-code">
                    <span className="text-base font-semibold text-ink">6-digit code</span>
                    <input
                      id="confirm-code"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      value={code}
                      onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                      className="mt-2 min-h-12 w-full rounded-2xl border border-line bg-paper-raised px-4 text-base text-ink"
                    />
                  </label>
                ) : null}
                {codeSent && normalizeUsPhone(draft.customerPhone) ? (
                  <p className="text-base text-ink">{codeSentMessage(draft.customerPhone)}</p>
                ) : null}
              </>
            ) : null}
            {otpError ? (
              <p role="alert" className="text-sm font-medium text-danger">
                {otpError}
              </p>
            ) : null}
            {photoIds.length > 0 ? (
              <ul className="grid gap-3">
                {photoIds.map((id) => (
                  <li key={id} className="rounded-2xl bg-paper-raised px-4 py-3 ring-1 ring-line">
                    <p className="font-semibold text-ink">
                      Photo {photoProgress[id] === "done" ? "saved" : photoProgress[id] === "uploading" ? "uploading" : "waiting"}
                    </p>
                    {missingPhotos.includes(id) ? (
                      <label className="mt-2 block text-sm font-semibold text-ink">
                        Choose this photo again
                        <input
                          type="file"
                          accept="image/jpeg,image/png,image/webp"
                          className="mt-2 block w-full"
                          onChange={(event) => void reselectPhoto(id, event.target.files)}
                        />
                      </label>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        ) : null}

        {!verifying && step.id === "what" ? (
          <>
            <section className="grid gap-5">
              <h1 className="font-display text-4xl font-semibold tracking-tight text-ink">What do you need?</h1>
              <RadioCards
                legend="Service"
                name="service"
                value={draft.service}
                error={errors.service}
                onChange={(id) => update("service", id as ServiceId)}
                options={services.map((service) => ({
                  id: service.id,
                  label: service.name,
                  hint: service.summary,
                }))}
              />
            </section>
            <ItemStep
              draft={draft}
              errors={errors}
              update={update}
              warning={warning}
              previews={previews}
              photoError={photoError}
              onPhotos={addPhotos}
              onRemove={removePhoto}
            />
          </>
        ) : null}

        {!verifying && step.id === "where" ? (
          <section className="grid gap-5">
            <h1 className="font-display text-4xl font-semibold tracking-tight text-ink">Where and when?</h1>
            <p className="text-base leading-relaxed text-muted">{privacyAreaNote}</p>
            <AddressLookup
              label="Search pickup address"
              onPick={(place) => {
                if (place.line1) update("pickupStreet", place.line1);
                update("pickupCity", place.city);
                update("pickupZip", place.zip);
                update("pickupLat", place.line1 ? place.lat : null);
                update("pickupLng", place.line1 ? place.lng : null);
                update("pickupVerified", Boolean(place.line1));
              }}
            />
            <TextField
              label="Pickup street address"
              name="pickupStreet"
              autoComplete="street-address"
              value={draft.pickupStreet}
              error={errors.pickupStreet}
              onChange={(value) => {
                update("pickupStreet", value);
                update("pickupVerified", false);
                update("pickupLat", null);
                update("pickupLng", null);
              }}
            />
            <TextField
              label="Pickup apt or unit"
              name="pickupUnit"
              value={draft.pickupUnit}
              onChange={(value) => update("pickupUnit", value)}
            />
            <TextField
              label="Pickup city"
              name="pickupCity"
              autoComplete="address-level2"
              value={draft.pickupCity}
              error={errors.pickupCity}
              onChange={(value) => update("pickupCity", value)}
            />
            <TextField
              label="Pickup ZIP"
              name="pickupZip"
              inputMode="numeric"
              autoComplete="postal-code"
              value={draft.pickupZip}
              error={errors.pickupZip}
              onChange={(value) => {
                update("pickupZip", value);
                update("pickupVerified", false);
                update("pickupLat", null);
                update("pickupLng", null);
              }}
            />
            <button
              type="button"
              className="min-h-12 text-left text-base font-semibold text-brand"
              onClick={() => {
                update("pickupVerified", false);
                update("pickupLat", null);
                update("pickupLng", null);
              }}
            >
              Use this address anyway
            </button>
            {draft.service !== "junk" ? (
              <>
                <AddressLookup
                  label="Search drop-off address"
                  onPick={(place) => {
                    if (place.line1) update("dropoffStreet", place.line1);
                    update("dropoffCity", place.city);
                    update("dropoffZip", place.zip);
                    update("dropoffLat", place.line1 ? place.lat : null);
                    update("dropoffLng", place.line1 ? place.lng : null);
                    update("dropoffVerified", Boolean(place.line1));
                  }}
                />
                <TextField
                  label="Drop-off street address"
                  name="dropoffStreet"
                  autoComplete="street-address"
                  value={draft.dropoffStreet}
                  error={errors.dropoffStreet}
                  onChange={(value) => {
                    update("dropoffStreet", value);
                    update("dropoffVerified", false);
                    update("dropoffLat", null);
                    update("dropoffLng", null);
                  }}
                />
                <TextField
                  label="Drop-off apt or unit"
                  name="dropoffUnit"
                  value={draft.dropoffUnit}
                  onChange={(value) => update("dropoffUnit", value)}
                />
                <TextField
                  label="Drop-off city"
                  name="dropoffCity"
                  autoComplete="address-level2"
                  value={draft.dropoffCity}
                  error={errors.dropoffCity}
                  onChange={(value) => update("dropoffCity", value)}
                />
                <TextField
                  label="Drop-off ZIP"
                  name="dropoffZip"
                  inputMode="numeric"
                  autoComplete="postal-code"
                  value={draft.dropoffZip}
                  error={errors.dropoffZip}
                  onChange={(value) => update("dropoffZip", value)}
                />
              </>
            ) : (
              <p className="text-base text-muted">Junk removal does not need a drop-off address.</p>
            )}
            <TripPreview
              pickup={{
                lat: draft.pickupLat,
                lng: draft.pickupLng,
                verified: draft.pickupVerified,
                text: [draft.pickupStreet, draft.pickupCity, draft.pickupZip].filter(Boolean).join(", "),
              }}
              dropoff={
                draft.service === "junk"
                  ? null
                  : {
                      lat: draft.dropoffLat,
                      lng: draft.dropoffLng,
                      verified: draft.dropoffVerified,
                      text: [draft.dropoffStreet, draft.dropoffCity, draft.dropoffZip].filter(Boolean).join(", "),
                    }
              }
            />
            <RadioCards
              legend="Stairs at pickup"
              name="stairsPickup"
              value={draft.stairsPickup}
              error={errors.stairsPickup}
              options={stairChoices}
              onChange={(id) => update("stairsPickup", id as RequestDraft["stairsPickup"])}
            />
            {draft.service !== "junk" ? (
              <RadioCards
                legend="Stairs at drop-off"
                name="stairsDropoff"
                value={draft.stairsDropoff}
                error={errors.stairsDropoff}
                options={stairChoices}
                onChange={(id) => update("stairsDropoff", id as RequestDraft["stairsDropoff"])}
              />
            ) : null}
            <YesNo
              legend="Is there an elevator?"
              name="elevator"
              value={draft.elevator}
              error={errors.elevator}
              onChange={(value) => update("elevator", value)}
            />
            <YesNo
              legend="I can help load"
              name="helpLoading"
              value={draft.helpLoading}
              error={errors.helpLoading}
              onChange={(value) => update("helpLoading", value)}
            />
            <RadioCards
              legend="When"
              name="preferredDate"
              value={
                draft.preferredDate === "asap" || draft.preferredDate === "today"
                  ? draft.preferredDate
                  : draft.preferredDate
                    ? "date"
                    : ""
              }
              error={errors.preferredDate}
              options={[
                { id: "asap", label: "ASAP" },
                { id: "today", label: "Today" },
                { id: "date", label: "Choose a date" },
              ]}
              onChange={(id) => {
                if (id === "asap" || id === "today") update("preferredDate", id);
                else update("preferredDate", today);
              }}
            />
            {/^\d{4}-\d{2}-\d{2}$/.test(draft.preferredDate) ? (
              <TextField
                label="Date"
                name="chosenDate"
                type="date"
                min={today}
                max={addDays(today, 5)}
                value={draft.preferredDate}
                onChange={(value) => update("preferredDate", value)}
              />
            ) : null}
            {draft.preferredDate !== "asap" ? (
              <RadioCards
                legend="Time window"
                name="timeWindow"
                value={draft.timeWindow}
                error={errors.timeWindow}
                options={timeWindows}
                onChange={(id) => update("timeWindow", id as RequestDraft["timeWindow"])}
              />
            ) : null}
            <TextAreaField
              label="Access instructions"
              name="accessNotes"
              optional
              hint="Gate code, parking, or which entrance."
              value={draft.accessNotes}
              onChange={(value) => update("accessNotes", value)}
            />
            <TextAreaField
              label="Notes"
              name="notes"
              optional
              value={draft.notes}
              onChange={(value) => update("notes", value)}
            />
          </section>
        ) : null}

        {!verifying && step.id === "price" ? (
          <section className="grid gap-5">
            <h1 className="font-display text-4xl font-semibold tracking-tight text-ink">Your price</h1>
            <p className="text-base leading-relaxed text-muted">{quotePricingCopy}</p>
            <RadioCards
              legend="Pricing method"
              name="pricingMethod"
              value={draft.pricingMethod}
              error={errors.pricingMethod}
              options={pricingMethods}
              onChange={(id) => update("pricingMethod", id as RequestDraft["pricingMethod"])}
            />
            {draft.pricingMethod === "fixed" || draft.pricingMethod === "range" ? (
              <p className="text-base leading-relaxed text-muted">{driverPricingCopy}</p>
            ) : null}
            {draft.pricingMethod === "fixed" ? (
              <TextField
                label="Your price"
                name="offerDollars"
                inputMode="decimal"
                hint="Minimum $35."
                value={draft.offerDollars}
                error={errors.offerDollars}
                onChange={(value) => update("offerDollars", value)}
              />
            ) : null}
            {draft.pricingMethod === "range" ? (
              <>
                <TextField
                  label="Minimum"
                  name="budgetMinDollars"
                  inputMode="decimal"
                  hint="At least $35."
                  value={draft.budgetMinDollars}
                  error={errors.budgetMinDollars}
                  onChange={(value) => update("budgetMinDollars", value)}
                />
                <TextField
                  label="Maximum"
                  name="budgetMaxDollars"
                  inputMode="decimal"
                  hint="Greater than the minimum."
                  value={draft.budgetMaxDollars}
                  error={errors.budgetMaxDollars}
                  onChange={(value) => update("budgetMaxDollars", value)}
                />
              </>
            ) : null}
          </section>
        ) : null}

        {!verifying && step.id === "verify" ? (
          <ReviewStep
            draft={draft}
            errors={errors}
            warning={warning}
            hideContact={signedIn === true && Boolean(draft.customerName.trim()) && Boolean(normalizeUsPhone(draft.customerPhone))}
            onEdit={goToStep}
            onAgree={(checked) => update("agreedToTerms", checked)}
            update={update}
          />
        ) : null}

        {formError ? (
          <p role="alert" className="mt-4 text-sm font-medium text-danger">
            {formError}
          </p>
        ) : null}

        <div className="mt-8 flex gap-3">
          {stepIndex > 0 ? (
            <button
              type="button"
              className={secondaryButton}
              onClick={() => {
                setErrors({});
                setStepIndex((index) => index - 1);
              }}
            >
              Back
            </button>
          ) : null}
          <button type="submit" className={primaryButton} disabled={submitting || (verifying && signedIn === null)}>
            {submitting
              ? "Saving…"
              : verifying
                ? signedIn
                  ? "Save request"
                  : codeSent
                    ? "Verify and continue"
                    : "Text me a code"
                : step.id === "verify"
                  ? signedIn
                    ? "Send request"
                    : "Continue"
                  : "Next"}
          </button>
        </div>
        <div className="h-28 sm:hidden" aria-hidden="true" />
      </form>
      <EstimateBar draft={draft} />
    </main>
  );
}

function EstimateBar({ draft }: { draft: RequestDraft }) {
  if (!draft.service) return null;
  return (
    <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-paper-raised px-4 py-3 shadow-[0_-8px_24px_rgba(20,33,27,0.06)] sm:static sm:mx-auto sm:mt-2 sm:max-w-xl sm:rounded-3xl sm:border sm:shadow-none">
      <p className="text-sm leading-relaxed font-semibold text-ink">{estimateMessage(estimateForDraft(draft))}</p>
    </div>
  );
}

function ItemStep({
  draft,
  errors,
  update,
  warning,
  previews,
  photoError,
  onPhotos,
  onRemove,
}: {
  draft: RequestDraft;
  errors: FieldErrors;
  update: <K extends keyof RequestDraft>(key: K, value: RequestDraft[K]) => void;
  warning: string | null;
  previews: Preview[];
  photoError: string | null;
  onPhotos: (list: FileList | null) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <section className="mt-6 grid gap-5">
      <TextAreaField
        label="What needs a ride?"
        name="description"
        hint="A photo or one line is enough."
        value={draft.description}
        error={errors.description}
        onChange={(value) => update("description", value)}
      />
      <TextField
        label="Listing link"
        name="listingUrl"
        type="url"
        inputMode="url"
        optional
        value={draft.listingUrl}
        error={errors.listingUrl}
        onChange={(value) => update("listingUrl", value)}
      />
      <div>
        <label className="block text-base font-semibold text-ink" htmlFor="photos">
          Photos <span className="font-normal text-muted">(up to {maxPhotos})</span>
        </label>
        <input
          id="photos"
          name="photos"
          type="file"
          accept="image/*"
          multiple
          onChange={(event) => {
            void onPhotos(event.target.files);
            event.target.value = "";
          }}
          className="mt-2 block w-full text-base"
        />
        {photoError ? (
          <p role="alert" className="mt-2 text-sm font-medium text-danger">
            {photoError}
          </p>
        ) : null}
        {previews.length > 0 ? (
          <ul className="mt-3 grid grid-cols-3 gap-2">
            {previews.map((preview) => (
              <li key={preview.id} className="relative">
                {/* Local compressed preview, not a remote image. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={preview.url} alt="" className="aspect-square w-full rounded-2xl object-cover" />
                <button
                  type="button"
                  className="mt-1 inline-flex min-h-12 w-full items-center justify-center rounded-full text-sm font-semibold text-ink underline"
                  onClick={() => onRemove(preview.id)}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      {draft.service === "junk" ? (
        <RadioCards
          legend="Load size"
          name="junkLoadSize"
          value={draft.junkLoadSize}
          error={errors.junkLoadSize}
          options={junkLoadSizes}
          onChange={(id) => update("junkLoadSize", id as RequestDraft["junkLoadSize"])}
        />
      ) : null}
      <details className="rounded-3xl bg-paper-raised p-4 ring-1 ring-line">
        <summary className="cursor-pointer text-base font-semibold text-ink">Add details (optional)</summary>
        <div className="mt-4 grid gap-5">
      <TextField
        label="Number of pieces"
        name="pieces"
        inputMode="numeric"
        optional
        value={draft.pieces}
        error={errors.pieces}
        onChange={(value) => update("pieces", value)}
      />
      <RadioCards
        legend="Approximate size"
        name="size"
        value={draft.size}
        error={errors.size}
        options={itemSizes}
        onChange={(id) => update("size", id as RequestDraft["size"])}
      />
        <TextField
        label="Approximate item value"
        name="itemValue"
        inputMode="decimal"
        optional
        hint="Use 0 if it is free."
        value={draft.itemValue}
        error={errors.itemValue}
        onChange={(value) => update("itemValue", value)}
      />
      {warning ? <p className="text-base font-medium text-ink">{warning}</p> : null}
      {draft.service === "delivery" ? (
        <>
          <YesNo
            legend="Already paid?"
            name="alreadyPaid"
            value={draft.alreadyPaid}
            error={errors.alreadyPaid}
            onChange={(value) => update("alreadyPaid", value)}
          />
          <YesNo
            legend="Is the seller holding it?"
            name="sellerHolding"
            value={draft.sellerHolding}
            error={errors.sellerHolding}
            onChange={(value) => update("sellerHolding", value)}
          />
          <YesNo
            legend="Want a video item check before pickup?"
            name="wantsItemCheck"
            value={draft.wantsItemCheck}
            error={errors.wantsItemCheck}
            onChange={(value) => update("wantsItemCheck", value)}
          />
        </>
      ) : null}
      {draft.service === "junk" ? (
        <>
          <TextAreaField
            label="Materials"
            name="junkMaterials"
            optional
            value={draft.junkMaterials}
            error={errors.junkMaterials}
            onChange={(value) => update("junkMaterials", value)}
          />
          <CheckField
            name="junkMattress"
            checked={draft.junkMattress}
            onChange={(checked) => update("junkMattress", checked)}
            label="Includes a mattress"
          />
          <CheckField
            name="junkTires"
            checked={draft.junkTires}
            onChange={(checked) => update("junkTires", checked)}
            label="Includes tires"
          />
          <CheckField
            name="junkAppliances"
            checked={draft.junkAppliances}
            onChange={(checked) => update("junkAppliances", checked)}
            label="Includes appliances"
          />
        </>
      ) : null}
      {draft.service === "construction" ? (
        <>
          <TextField
            label="Store name"
            name="storeName"
            optional
            value={draft.storeName}
            error={errors.storeName}
            onChange={(value) => update("storeName", value)}
          />
          <TextField
            label="Order or pickup number"
            name="storeOrderNumber"
            optional
            value={draft.storeOrderNumber}
            onChange={(value) => update("storeOrderNumber", value)}
          />
        </>
      ) : null}
        </div>
      </details>
    </section>
  );
}

function ReviewStep({
  draft,
  errors,
  warning,
  hideContact,
  onEdit,
  onAgree,
  update,
}: {
  draft: RequestDraft;
  errors: FieldErrors;
  warning: string | null;
  hideContact: boolean;
  onEdit: (id: RequestStepId) => void;
  onAgree: (checked: boolean) => void;
  update: <K extends keyof RequestDraft>(key: K, value: RequestDraft[K]) => void;
}) {
  const serviceName = draft.service ? serviceById(draft.service).name : "Not chosen";
  const offer = parseDollarsToCents(draft.offerDollars);
  const min = parseDollarsToCents(draft.budgetMinDollars);
  const max = parseDollarsToCents(draft.budgetMaxDollars);
  return (
    <section className="grid gap-5">
      <h1 className="font-display text-4xl font-semibold tracking-tight text-ink">Check and send</h1>
      <Summary title="What" onEdit={() => onEdit("what")}>
        <p>{serviceName}</p>
      </Summary>
      <Summary title="Item" onEdit={() => onEdit("what")}>
        <p>{draft.description || "No description"}</p>
        <p>
          {draft.pieces || "—"} pieces · {labelOf(itemSizes, draft.size)}
        </p>
        {draft.service === "junk" ? <p>Load size: {labelOf(junkLoadSizes, draft.junkLoadSize)}</p> : null}
        {draft.service === "junk" ? <p>Materials: {draft.junkMaterials || "—"}</p> : null}
        {draft.service === "construction" ? <p>Store: {draft.storeName || "—"}</p> : null}
        {warning ? <p>{warning}</p> : null}
      </Summary>
      <Summary title="Where and when" onEdit={() => onEdit("where")}>
        <p>{draft.pickupStreet || "No pickup street"}</p>
        <p>
          {draft.pickupCity || "—"}, {draft.pickupZip || "—"}
        </p>
        {draft.service !== "junk" ? (
          <p>
            {draft.dropoffStreet || "No drop-off street"}, {draft.dropoffCity || "—"}, {draft.dropoffZip || "—"}
          </p>
        ) : (
          <p>No drop-off for junk removal.</p>
        )}
        {draft.accessNotes ? <p>{draft.accessNotes}</p> : null}
      </Summary>
      <Summary title="Your price" onEdit={() => onEdit("price")}>
        <p>
          {draft.preferredDate === "asap" ? "ASAP" : draft.preferredDate === "today" ? "Today" : draft.preferredDate || "No date"}
          {draft.timeWindow ? ` · ${labelOf(timeWindows, draft.timeWindow)}` : ""}
        </p>
        <p>{labelOf(pricingMethods, draft.pricingMethod)}</p>
        {draft.pricingMethod === "fixed" && offer != null ? <p>{formatCents(offer)}</p> : null}
        {draft.pricingMethod === "fixed" || draft.pricingMethod === "range" ? (
          <p>You will choose before booking.</p>
        ) : null}
        {draft.pricingMethod === "range" && min != null && max != null ? (
          <p>
            {formatCents(min)}–{formatCents(max)}
          </p>
        ) : null}
      </Summary>
      <p className="rounded-2xl bg-brand-soft px-4 py-3 text-base leading-relaxed text-ink">
        {estimateMessage(estimateForDraft(draft))}
      </p>
      {hideContact ? null : (
        <>
          <TextField
            label="Your name"
            name="customerName"
            autoComplete="name"
            value={draft.customerName}
            error={errors.customerName}
            onChange={(value) => update("customerName", value)}
          />
          <TextField
            label="Phone number"
            name="customerPhone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            value={draft.customerPhone}
            error={errors.customerPhone}
            onChange={(value) => update("customerPhone", value)}
          />
          <TextField
            label="Email"
            name="customerEmail"
            type="email"
            inputMode="email"
            autoComplete="email"
            optional
            value={draft.customerEmail}
            error={errors.customerEmail}
            onChange={(value) => update("customerEmail", value)}
          />
        </>
      )}
      <p className="text-base leading-relaxed text-ink">
        Late cancel fee {formatCents(fees.lateCancelFeeCents)}. Trip fee {formatCents(fees.tripFeeCents)}.{" "}
        <Link href="/terms" className="font-semibold text-brand underline">
          Terms, fees, and prohibited items
        </Link>
        .
      </p>
      <CheckField
        name="agreedToTerms"
        checked={draft.agreedToTerms}
        error={errors.agreedToTerms}
        onChange={onAgree}
        label="I agree to the terms, fees, and prohibited items."
      />
    </section>
  );
}

function Summary({
  title,
  onEdit,
  children,
}: {
  title: string;
  onEdit: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-3xl bg-paper-raised p-4 ring-1 ring-line">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-ink">{title}</h2>
        <button type="button" className="inline-flex min-h-12 items-center px-2 font-semibold text-brand underline" onClick={onEdit}>
          Edit {title}
        </button>
      </div>
      <div className="mt-2 space-y-1 text-base leading-relaxed text-ink">{children}</div>
    </section>
  );
}

function labelOf(options: readonly { id: string; label: string }[], id: string): string {
  return options.find((option) => option.id === id)?.label ?? "—";
}
