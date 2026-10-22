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

export function validateStep(step: RequestStepId, draft: RequestDraft): FieldErrors {
  if (step === "service") return validateService(draft);
  if (step === "item") return validateItem(draft);
  if (step === "where") return validateWhere(draft);
  if (step === "access") return validateAccess(draft);
  if (step === "contact") return validateContact(draft);
  return validateReview(draft);
}

export function validateRequest(draft: RequestDraft): FieldErrors {
  return {
    ...validateService(draft),
    ...validateItem(draft),
    ...validateWhere(draft),
    ...validateAccess(draft),
    ...validateContact(draft),
    ...validateReview(draft),
  };
}

function validateService(draft: RequestDraft): FieldErrors {
  const parsed = serviceSchema.safeParse(draft.service);
  return parsed.success ? {} : { service: "Choose a service." };
}

function validateItem(draft: RequestDraft): FieldErrors {
  const errors: FieldErrors = {};
  if (!requiredText("Describe what needs a ride.").safeParse(draft.description).success) {
    errors.description = "Describe what needs a ride.";
  }
  const url = listingUrl(draft.listingUrl);
  if (url === false) errors.listingUrl = "Enter a full http or https link, or leave this blank.";
  if (pieces(draft.pieces) == null) errors.pieces = "Enter the number of pieces (at least 1).";
  if (!sizeSchema.safeParse(draft.size).success) errors.size = "Choose an approximate size.";
  const value = itemValueCents(draft);
  if (value == null) errors.itemValue = "Enter an approximate value. Use 0 if it is free.";
  if (draft.service === "delivery") {
    if (!yesNo.safeParse(draft.alreadyPaid).success) errors.alreadyPaid = "Say whether you already paid.";
    if (!yesNo.safeParse(draft.sellerHolding).success) {
      errors.sellerHolding = "Say whether the seller is holding it.";
    }
    if (!yesNo.safeParse(draft.wantsItemCheck).success) {
      errors.wantsItemCheck = "Say whether you want a video item check.";
    }
  }
  if (draft.service === "junk") {
    if (!loadSchema.safeParse(draft.junkLoadSize).success) errors.junkLoadSize = "Choose a load size.";
    if (!requiredText("Describe the materials.").safeParse(draft.junkMaterials).success) {
      errors.junkMaterials = "Describe the materials.";
    }
  }
  if (draft.service === "construction") {
    if (!requiredText("Enter the store name.").safeParse(draft.storeName).success) {
      errors.storeName = "Enter the store name.";
    }
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

function validateAccess(draft: RequestDraft): FieldErrors {
  const errors: FieldErrors = {};
  if (!stairSchema.safeParse(draft.stairsPickup).success) {
    errors.stairsPickup = "Choose the stairs at pickup.";
  }
  if (draft.service !== "junk" && !stairSchema.safeParse(draft.stairsDropoff).success) {
    errors.stairsDropoff = "Choose the stairs at drop-off.";
  }
  if (!yesNo.safeParse(draft.elevator).success) errors.elevator = "Say whether there is an elevator.";
  if (!yesNo.safeParse(draft.helpLoading).success) {
    errors.helpLoading = "Say whether someone can help load.";
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

function validateContact(draft: RequestDraft): FieldErrors {
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
  if (!requiredText("Enter your name.").safeParse(draft.customerName).success) {
    errors.customerName = "Enter your name.";
  }
  if (!normalizeUsPhone(draft.customerPhone)) {
    errors.customerPhone = "Enter a 10-digit US phone number.";
  }
  const email = draft.customerEmail.trim();
  if (email && !z.string().email().safeParse(email).success) {
    errors.customerEmail = "Enter a valid email, or leave it blank.";
  }
  if (!hearSchema.safeParse(draft.hearAbout).success) {
    errors.hearAbout = "Tell us how you heard about Pickuply.";
  }
  return errors;
}

function validateReview(draft: RequestDraft): FieldErrors {
  return draft.agreedToTerms ? {} : { agreedToTerms: "Agree to the terms to submit." };
}

export function valueWarning(draft: RequestDraft): string | null {
  const cents = itemValueCents(draft);
  if (cents == null || !needsValueApproval(cents)) return null;
  return valueApprovalWarning;
}
