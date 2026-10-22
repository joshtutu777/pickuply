import assert from "node:assert/strict";
import test from "node:test";
import { fees } from "../constants";
import { emptyDraft } from "../types";
import { validateStep } from "./request";

test("quote pricing needs no amount", () => {
  const draft = emptyDraft("delivery");
  draft.pricingMethod = "quote";
  draft.customerName = "Ada";
  draft.customerPhone = "(404) 555-1212";
  draft.hearAbout = "nextdoor";
  const errors = validateStep("contact", draft);
  assert.equal(errors.pricingMethod, undefined);
  assert.equal(errors.offerDollars, undefined);
});

test("a fixed price under $35 is rejected", () => {
  const draft = emptyDraft("delivery");
  draft.pricingMethod = "fixed";
  draft.offerDollars = "34";
  draft.customerName = "Ada";
  draft.customerPhone = "4045551212";
  draft.hearAbout = "friend";
  const errors = validateStep("contact", draft);
  assert.match(errors.offerDollars ?? "", /at least \$35/);
  draft.offerDollars = "35";
  assert.equal(validateStep("contact", draft).offerDollars, undefined);
});

test("a budget range must start at $35 and the max must be higher", () => {
  const draft = emptyDraft("junk");
  draft.pricingMethod = "range";
  draft.budgetMinDollars = "35";
  draft.budgetMaxDollars = "35";
  draft.customerName = "Ada";
  draft.customerPhone = "14045551212";
  draft.hearAbout = "other";
  assert.match(validateStep("contact", draft).budgetMaxDollars ?? "", /greater than/);
  draft.budgetMinDollars = "20";
  draft.budgetMaxDollars = "80";
  assert.match(validateStep("contact", draft).budgetMinDollars ?? "", /at least \$35/);
  draft.budgetMinDollars = "40";
  assert.equal(validateStep("contact", draft).budgetMinDollars, undefined);
  assert.equal(validateStep("contact", draft).budgetMaxDollars, undefined);
});

test("phone numbers must be US numbers and email may be blank", () => {
  const draft = emptyDraft("delivery");
  draft.pricingMethod = "quote";
  draft.customerName = "Ada";
  draft.customerPhone = "555";
  draft.customerEmail = "";
  draft.hearAbout = "facebook";
  assert.match(validateStep("contact", draft).customerPhone ?? "", /10-digit/);
  draft.customerPhone = "404-555-1212";
  draft.customerEmail = "not-an-email";
  assert.equal(validateStep("contact", draft).customerPhone, undefined);
  assert.match(validateStep("contact", draft).customerEmail ?? "", /valid email/);
});

test("item value over the cap is allowed", () => {
  const draft = emptyDraft("delivery");
  draft.description = "Sofa";
  draft.pieces = "1";
  draft.size = "large";
  draft.itemValue = String(fees.itemValueCapCents / 100 + 1);
  draft.alreadyPaid = "yes";
  draft.sellerHolding = "yes";
  draft.wantsItemCheck = "no";
  assert.equal(validateStep("item", draft).itemValue, undefined);
});

test("terms must be accepted on review", () => {
  const draft = emptyDraft("delivery");
  assert.match(validateStep("review", draft).agreedToTerms ?? "", /Agree/);
  draft.agreedToTerms = true;
  assert.equal(validateStep("review", draft).agreedToTerms, undefined);
});
