import assert from "node:assert/strict";
import test from "node:test";
import { fees } from "../constants";
import { emptyDraft } from "../types";
import { profileEmailError } from "./email";
import { validateStep } from "./request";

test("quote pricing needs no amount", () => {
  const draft = emptyDraft("delivery");
  draft.pricingMethod = "quote";
  draft.customerName = "Ada";
  draft.customerPhone = "(404) 555-1212";
  draft.hearAbout = "nextdoor";
  const errors = validateStep("price", draft);
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
  const errors = validateStep("price", draft);
  assert.match(errors.offerDollars ?? "", /at least \$35/);
  draft.offerDollars = "35";
  assert.equal(validateStep("price", draft).offerDollars, undefined);
});

test("a budget range must start at the service minimum and the max must be higher", () => {
  const draft = emptyDraft("junk");
  draft.pricingMethod = "range";
  draft.budgetMinDollars = "50";
  draft.budgetMaxDollars = "50";
  draft.customerName = "Ada";
  draft.customerPhone = "14045551212";
  draft.hearAbout = "other";
  assert.match(validateStep("price", draft).budgetMaxDollars ?? "", /greater than/);
  draft.budgetMinDollars = "35";
  draft.budgetMaxDollars = "80";
  assert.match(validateStep("price", draft).budgetMinDollars ?? "", /at least \$50/);
  draft.budgetMinDollars = "50";
  assert.equal(validateStep("price", draft).budgetMinDollars, undefined);
  assert.equal(validateStep("price", draft).budgetMaxDollars, undefined);
});

test("profile email is optional and rejects a bad address", () => {
  assert.equal(profileEmailError(""), null);
  assert.equal(profileEmailError("   "), null);
  assert.equal(profileEmailError("ada@example.com"), null);
  assert.match(profileEmailError("not-an-email") ?? "", /valid email/);
});

test("phone numbers must be US numbers and email may be blank", () => {
  const draft = emptyDraft("delivery");
  draft.pricingMethod = "quote";
  draft.customerName = "Ada";
  draft.customerPhone = "555";
  draft.customerEmail = "";
  draft.hearAbout = "facebook";
  assert.match(validateStep("verify", draft).customerPhone ?? "", /10-digit/);
  draft.customerPhone = "404-555-1212";
  draft.customerEmail = "not-an-email";
  draft.agreedToTerms = true;
  assert.equal(validateStep("verify", draft).customerPhone, undefined);
  assert.match(validateStep("verify", draft).customerEmail ?? "", /valid email/);
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
  assert.equal(validateStep("what", draft).itemValue, undefined);
});

test("a photo can stand in for a description", () => {
  const draft = emptyDraft("delivery");
  assert.match(validateStep("what", draft, { photoCount: 0 }).description ?? "", /photo or a short/);
  assert.equal(validateStep("what", draft, { photoCount: 1 }).description, undefined);
});

test("terms must be accepted on review", () => {
  const draft = emptyDraft("delivery");
  draft.customerName = "Ada";
  draft.customerPhone = "4045551212";
  assert.match(validateStep("verify", draft).agreedToTerms ?? "", /Agree/);
  draft.agreedToTerms = true;
  assert.equal(validateStep("verify", draft).agreedToTerms, undefined);
});
