import { z } from "zod";
import {
  fees,
  hearAboutOptions,
  itemSizes,
  junkLoadSizes,
  serviceIds,
  stairChoices,
  timeWindows,
  valueApprovalWarning,
  type RequestStepId,
} from "../constants";
import { isWithinBookingWindow } from "../dates";
import { parseDollarsToCents } from "../money";
import { normalizeUsPhone } from "../phone";
import type { RequestDraft } from "../types";

export type FieldErrors = Partial<Record<string, string>>;

const serviceSchema = z.enum(serviceIds as unknown as [string, ...string[]]);
const sizeSchema = z.enum(itemSizes.map((item) => item.id) as [string, ...string[]]);
const loadSchema = z.enum(junkLoadSizes.map((item) => item.id) as [string, ...string[]]);
const stairSchema = z.enum(stairChoices.map((item) => item.id) as [string, ...string[]]);
const windowSchema = z.enum(timeWindows.map((item) => item.id) as [string, ...string[]]);
const hearSchema = z.enum(hearAboutOptions.map((item) => item.id) as [string, ...string[]]);
const yesNo = z.enum(["yes", "no"]);

function requiredText(message: string) {
  return z.string().trim().min(1, message);
}

function pieces(value: string) {
  if (!/^\d+$/.test(value.trim())) return null;
  const parsed = Number(value);
  return parsed >= 1 ? parsed : null;
}

function listingUrl(value: string): string | null | false {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    return trimmed;
  } catch {
    return false;
  }
}

function zipCode(value: string) {
  return /^\d{5}$/.test(value.trim());
}

export function itemValueCents(draft: RequestDraft): number | null {
  return parseDollarsToCents(draft.itemValue);
}

export function needsValueApproval(cents: number): boolean {
  return cents > fees.itemValueCapCents;
}

export function validateStep(
  step: RequestStepId,
  draft: RequestDraft,
  options?: { photoCount?: number; signedIn?: boolean },
): FieldErrors {
  if (step === "what") return validateWhat(draft, options?.photoCount ?? 0);
  if (step === "where") return { ...validateWhere(draft), ...validateWhen(draft) };
  if (step === "price") return validatePrice(draft);
  return validateVerify(draft, options?.signedIn === true);
}

export function validateRequest(
  draft: RequestDraft,
  options?: { photoCount?: number; signedIn?: boolean },
): FieldErrors {
  return {
    ...validateWhat(draft, options?.photoCount ?? 0),
    ...validateWhere(draft),
    ...validateWhen(draft),
    ...validatePrice(draft),
    ...validateVerify(draft, options?.signedIn === true),
  };
}

function validateWhat(draft: RequestDraft, photoCount: number): FieldErrors {
  const errors: FieldErrors = {};
  if (!serviceSchema.safeParse(draft.service).success) errors.service = "Choose a service.";
  const described = requiredText("Add a photo or a short description.").safeParse(draft.description).success;
  if (!described && photoCount < 1) {
    errors.description = "Add a photo or a short description.";
  }
  if (listingUrl(draft.listingUrl) === false) {
    errors.listingUrl = "Enter a full http or https link, or leave this blank.";
  }
  if (draft.pieces.trim() && pieces(draft.pieces) == null) {
    errors.pieces = "Enter the number of pieces (at least 1).";
  }
  if (draft.size && !sizeSchema.safeParse(draft.size).success) errors.size = "Choose an approximate size.";
  if (draft.itemValue.trim() && itemValueCents(draft) == null) {
    errors.itemValue = "Enter an approximate value, or leave it blank.";
  }
  if (draft.service === "delivery") {
    if (draft.alreadyPaid && !yesNo.safeParse(draft.alreadyPaid).success) {
      errors.alreadyPaid = "Say whether you already paid.";
    }
    if (draft.sellerHolding && !yesNo.safeParse(draft.sellerHolding).success) {
      errors.sellerHolding = "Say whether the seller is holding it.";
    }
    if (draft.wantsItemCheck && !yesNo.safeParse(draft.wantsItemCheck).success) {
      errors.wantsItemCheck = "Say whether you want a video item check.";
    }
  }
  if (draft.service === "junk") {
    if (draft.junkLoadSize && !loadSchema.safeParse(draft.junkLoadSize).success) {
      errors.junkLoadSize = "Choose a load size.";
    }
    if (draft.junkMaterials.trim().length > 1000) errors.junkMaterials = "Materials are too long.";
  }
  if (draft.service === "construction" && draft.storeName.trim().length > 120) {
    errors.storeName = "Store name is too long.";
  }
  return errors;
}

function validateWhere(draft: RequestDraft): FieldErrors {
  const errors: FieldErrors = {};
  if (!requiredText("Enter the pickup street address.").safeParse(draft.pickupStreet).success) {
    errors.pickupStreet = "Enter the pickup street address.";
  }
  if (!requiredText("Enter the pickup city.").safeParse(draft.pickupCity).success) {
    errors.pickupCity = "Enter the pickup city.";
  }
  if (!zipCode(draft.pickupZip)) errors.pickupZip = "Enter a 5-digit pickup ZIP code.";
  if (draft.service !== "junk") {
    if (!requiredText("Enter the drop-off street address.").safeParse(draft.dropoffStreet).success) {
      errors.dropoffStreet = "Enter the drop-off street address.";
    }
    if (!requiredText("Enter the drop-off city.").safeParse(draft.dropoffCity).success) {
      errors.dropoffCity = "Enter the drop-off city.";
    }
    if (!zipCode(draft.dropoffZip)) errors.dropoffZip = "Enter a 5-digit drop-off ZIP code.";
  }
  return errors;
}

function validateWhen(draft: RequestDraft): FieldErrors {
  const errors: FieldErrors = {};
  if (draft.stairsPickup && !stairSchema.safeParse(draft.stairsPickup).success) {
    errors.stairsPickup = "Choose the stairs at pickup.";
  }
  if (draft.service !== "junk" && draft.stairsDropoff && !stairSchema.safeParse(draft.stairsDropoff).success) {
    errors.stairsDropoff = "Choose the stairs at drop-off.";
  }
  if (!draft.preferredDate) {
    errors.preferredDate = "Choose ASAP, today, or a date.";
  } else if (draft.preferredDate !== "asap" && draft.preferredDate !== "today") {
    if (!isWithinBookingWindow(draft.preferredDate)) {
      errors.preferredDate = "Choose a date within the next 5 days.";
    }
  }
  if (draft.preferredDate !== "asap" && !windowSchema.safeParse(draft.timeWindow).success) {
    errors.timeWindow = "Choose a time window.";
  }
  return errors;
}

function validatePrice(draft: RequestDraft): FieldErrors {
  const errors: FieldErrors = {};
  if (draft.pricingMethod === "quote") {
    // No amount.
  } else if (draft.pricingMethod === "fixed") {
    const cents = parseDollarsToCents(draft.offerDollars);
    if (cents == null || cents < fees.minimumCents) {
      errors.offerDollars = "Enter a price of at least $35.";
    }
  } else if (draft.pricingMethod === "range") {
    const min = parseDollarsToCents(draft.budgetMinDollars);
    const max = parseDollarsToCents(draft.budgetMaxDollars);
    if (min == null || min < fees.minimumCents) {
      errors.budgetMinDollars = "Enter a minimum of at least $35.";
    }
    if (max == null) {
      errors.budgetMaxDollars = "Enter a maximum.";
    } else if (min != null && max <= min) {
      errors.budgetMaxDollars = "Maximum must be greater than the minimum.";
    }
  } else {
    errors.pricingMethod = "Choose how you want to price this.";
  }
  return errors;
}

function validateVerify(draft: RequestDraft, signedIn: boolean): FieldErrors {
  const errors: FieldErrors = {};
  if (!signedIn || draft.customerName.trim() || draft.customerPhone.trim()) {
    if (!requiredText("Enter your name.").safeParse(draft.customerName).success) {
      errors.customerName = "Enter your name.";
    }
    if (!normalizeUsPhone(draft.customerPhone)) {
      errors.customerPhone = "Enter a 10-digit US phone number.";
    }
  }
  const email = draft.customerEmail.trim();
  if (email && !z.string().email().safeParse(email).success) {
    errors.customerEmail = "Enter a valid email, or leave it blank.";
  }
  if (draft.hearAbout && !hearSchema.safeParse(draft.hearAbout).success) {
    errors.hearAbout = "Tell us how you heard about Pickuply.";
  }
  if (!draft.agreedToTerms) errors.agreedToTerms = "Agree to the terms to submit.";
  return errors;
}

export function valueWarning(draft: RequestDraft): string | null {
  const cents = itemValueCents(draft);
  if (cents == null || !needsValueApproval(cents)) return null;
  return valueApprovalWarning;
}
