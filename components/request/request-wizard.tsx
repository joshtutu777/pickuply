"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  fees,
  hearAboutOptions,
  itemSizes,
  junkLoadSizes,
  maxPhotos,
  driverPricingCopy,
  pricingMethods,
  privacyAreaNote,
  prohibitedItems,
  requestSteps,
  serviceById,
  services,
  stairChoices,
  timeWindows,
  valueApprovalWarning,
  type RequestStepId,
  type ServiceId,
} from "@/lib/constants";
import { createRequest } from "@/lib/data/requests";
import { addDays, localDateISO } from "@/lib/dates";
import { clearStoredDraft, loadStoredDraft, saveStoredDraft } from "@/lib/draft";
import { estimateForDraft, estimateMessage } from "@/lib/estimate";
import { formatCents, parseDollarsToCents } from "@/lib/money";
import { deletePhoto, loadPhoto, savePhoto } from "@/lib/photo-store";
import { compressImage } from "@/lib/photos";
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
  const router = useRouter();
  const [boot] = useState(() => loadBoot(initialService));
  const [showResume, setShowResume] = useState(boot.showResume);
  const [draft, setDraft] = useState<RequestDraft>(boot.draft);
  const [photoIds, setPhotoIds] = useState<string[]>(boot.photoIds);
  const photoIdsRef = useRef(photoIds);
  const [previews, setPreviews] = useState<Preview[]>([]);
  const [stepIndex, setStepIndex] = useState(0);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(boot.formError);
  const [submitting, setSubmitting] = useState(false);

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
      void saveRequest();
      return;
    }
    const step = requestSteps[stepIndex];
    if (step.id === "review") {
      const firstInvalid = requestSteps.findIndex(
        (item) => Object.keys(validateStep(item.id, draft)).length > 0,
      );
      if (firstInvalid >= 0) {
        setStepIndex(firstInvalid);
        const stepErrors = validateStep(requestSteps[firstInvalid].id, draft);
        setErrors(stepErrors);
        focusField(stepErrors);
        return;
      }
      setErrors({});
      setStepIndex(requestSteps.length);
      return;
    }
    const stepErrors = validateStep(step.id, draft);
    if (Object.keys(stepErrors).length > 0) {
      setErrors(stepErrors);
      focusField(stepErrors);
      return;
    }
    setErrors({});
    setStepIndex((index) => index + 1);
  }

  async function saveRequest() {
    setSubmitting(true);
    setFormError(null);
    try {
      const job = createRequest(draft, photoIds);
      clearStoredDraft();
      router.push(`/jobs/${job.id}`);
    } catch {
      setFormError("This browser couldn't save the request.");
      setSubmitting(false);
    }
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
          <section>
            <h1 className="font-display text-4xl font-semibold tracking-tight text-ink">
              Text verification will be added in a later step
            </h1>
            <p className="mt-4 text-lg leading-relaxed text-muted">
              No text message is sent from this demo. Saving keeps the request on this device only.
            </p>
          </section>
        ) : null}

        {!verifying && step.id === "service" ? (
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
        ) : null}

        {!verifying && step.id === "item" ? (
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
        ) : null}

        {!verifying && step.id === "where" ? (
          <section className="grid gap-5">
            <h1 className="font-display text-4xl font-semibold tracking-tight text-ink">Where is it?</h1>
            <p className="text-base leading-relaxed text-muted">{privacyAreaNote}</p>
            <TextField
              label="Pickup street address"
              name="pickupStreet"
              autoComplete="street-address"
              value={draft.pickupStreet}
              error={errors.pickupStreet}
              onChange={(value) => update("pickupStreet", value)}
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
              onChange={(value) => update("pickupZip", value)}
            />
            {draft.service !== "junk" ? (
              <>
                <TextField
                  label="Drop-off street address"
                  name="dropoffStreet"
                  autoComplete="street-address"
                  value={draft.dropoffStreet}
                  error={errors.dropoffStreet}
                  onChange={(value) => update("dropoffStreet", value)}
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
            <TextAreaField
              label="Access instructions"
              name="accessNotes"
              optional
              hint="Gate code, parking, or which entrance."
              value={draft.accessNotes}
              onChange={(value) => update("accessNotes", value)}
            />
          </section>
        ) : null}

        {!verifying && step.id === "access" ? (
          <section className="grid gap-5">
            <h1 className="font-display text-4xl font-semibold tracking-tight text-ink">Access and when</h1>
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
              legend="Can someone help load?"
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
              label="Notes"
              name="notes"
              optional
              value={draft.notes}
              onChange={(value) => update("notes", value)}
            />
          </section>
        ) : null}

        {!verifying && step.id === "contact" ? (
          <section className="grid gap-5">
            <h1 className="font-display text-4xl font-semibold tracking-tight text-ink">
              Contact and price
            </h1>
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
            <RadioCards
              legend="How did you hear about us?"
              name="hearAbout"
              value={draft.hearAbout}
              error={errors.hearAbout}
              options={hearAboutOptions}
              onChange={(id) => update("hearAbout", id as RequestDraft["hearAbout"])}
            />
          </section>
        ) : null}

        {!verifying && step.id === "review" ? (
          <ReviewStep draft={draft} errors={errors} warning={warning} onEdit={goToStep} onAgree={(checked) => update("agreedToTerms", checked)} />
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
          <button type="submit" className={primaryButton} disabled={submitting}>
            {submitting ? "Saving…" : verifying ? "Save on this device" : step.id === "review" ? "Submit" : "Next"}
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
    <section className="grid gap-5">
      <h1 className="font-display text-4xl font-semibold tracking-tight text-ink">What are we picking up?</h1>
      <TextAreaField
        label="What needs a ride?"
        name="description"
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
      <TextField
        label="Number of pieces"
        name="pieces"
        inputMode="numeric"
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
          <RadioCards
            legend="Load size"
            name="junkLoadSize"
            value={draft.junkLoadSize}
            error={errors.junkLoadSize}
            options={junkLoadSizes}
            onChange={(id) => update("junkLoadSize", id as RequestDraft["junkLoadSize"])}
          />
          <TextAreaField
            label="Materials"
            name="junkMaterials"
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
    </section>
  );
}

function ReviewStep({
  draft,
  errors,
  warning,
  onEdit,
  onAgree,
}: {
  draft: RequestDraft;
  errors: FieldErrors;
  warning: string | null;
  onEdit: (id: RequestStepId) => void;
  onAgree: (checked: boolean) => void;
}) {
  const serviceName = draft.service ? serviceById(draft.service).name : "Not chosen";
  const offer = parseDollarsToCents(draft.offerDollars);
  const min = parseDollarsToCents(draft.budgetMinDollars);
  const max = parseDollarsToCents(draft.budgetMaxDollars);
  return (
    <section className="grid gap-5">
      <h1 className="font-display text-4xl font-semibold tracking-tight text-ink">Review</h1>
      <Summary title="Service" onEdit={() => onEdit("service")}>
        <p>{serviceName}</p>
      </Summary>
      <Summary title="Item" onEdit={() => onEdit("item")}>
        <p>{draft.description || "No description"}</p>
        <p>
          {draft.pieces || "—"} pieces · {labelOf(itemSizes, draft.size)}
        </p>
        {draft.service === "junk" ? <p>Load size: {labelOf(junkLoadSizes, draft.junkLoadSize)}</p> : null}
        {draft.service === "junk" ? <p>Materials: {draft.junkMaterials || "—"}</p> : null}
        {draft.service === "construction" ? <p>Store: {draft.storeName || "—"}</p> : null}
        {warning ? <p>{warning}</p> : null}
      </Summary>
      <Summary title="Where" onEdit={() => onEdit("where")}>
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
      <Summary title="Access and when" onEdit={() => onEdit("access")}>
        <p>Pickup stairs: {labelOf(stairChoices, draft.stairsPickup)}</p>
        <p>{draft.preferredDate === "asap" ? "ASAP" : draft.preferredDate === "today" ? "Today" : draft.preferredDate || "No date"}</p>
        {draft.timeWindow ? <p>{labelOf(timeWindows, draft.timeWindow)}</p> : null}
      </Summary>
      <Summary title="Contact and price" onEdit={() => onEdit("contact")}>
        <p>{draft.customerName || "No name"}</p>
        <p>{draft.customerPhone || "No phone"}</p>
        {draft.customerEmail ? <p>{draft.customerEmail}</p> : null}
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
        <p>{labelOf(hearAboutOptions, draft.hearAbout)}</p>
      </Summary>
      <p className="rounded-2xl bg-brand-soft px-4 py-3 text-base leading-relaxed text-ink">
        {estimateMessage(estimateForDraft(draft))}
      </p>
      <div>
        <h2 className="text-base font-semibold text-ink">Not accepted</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-base text-ink">
          {prohibitedItems.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </div>
      <CheckField
        name="agreedToTerms"
        checked={draft.agreedToTerms}
        error={errors.agreedToTerms}
        onChange={onAgree}
        label={`I agree this request does not include prohibited items. The late cancel fee is ${formatCents(fees.lateCancelFeeCents)} after a driver is assigned. The trip fee is ${formatCents(fees.tripFeeCents)} if I reject the item at the pickup item check. The damage coverage limit is ${formatCents(fees.damageCoverageLimitCents)} per job. ${valueApprovalWarning} Photos I add are part of this request.`}
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
