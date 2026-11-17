import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fees } from "../constants";
import { emptyDraft } from "../types";
import { driverApplyEmailError, profileEmailError, requestEmailError } from "./email";
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

test("a request email is required, trimmed, and checked before the database save", () => {
  assert.equal(requestEmailError(""), "Please enter your email address.");
  assert.equal(requestEmailError("   "), "Please enter your email address.");
  assert.equal(requestEmailError("not-an-email"), "Please enter a valid email address.");
  assert.equal(requestEmailError("ada@"), "Please enter a valid email address.");
  assert.equal(requestEmailError("  ada@example.com  "), null);
  const save = readFileSync(new URL("../data/requests.ts", import.meta.url), "utf8");
  assert.ok(save.indexOf("requestEmailError") < save.indexOf("create_customer_request"));
  const wizard = readFileSync(new URL("../../components/request/request-wizard.tsx", import.meta.url), "utf8");
  const saveStart = wizard.indexOf("async function saveRequest");
  const saveBody = wizard.slice(saveStart, wizard.indexOf("if (sentId)", saveStart));
  assert.ok(saveBody.indexOf("requestEmailError") < saveBody.indexOf("await createRequest"));
  assert.equal(readFileSync(new URL("../../components/request/fields.tsx", import.meta.url), "utf8").includes("border-danger"), true);
});

test("profile email is optional and rejects a bad address", () => {
  assert.equal(profileEmailError(""), null);
  assert.equal(profileEmailError("   "), null);
  assert.equal(profileEmailError("ada@example.com"), null);
  assert.match(profileEmailError("not-an-email") ?? "", /valid email/);
  assert.equal(driverApplyEmailError(""), "Enter your email.");
  assert.equal(driverApplyEmailError("ada@example.com"), null);
  assert.equal(driverApplyEmailError("not-an-email"), "Enter a valid email.");
});

test("phone numbers must be US numbers", () => {
  const draft = emptyDraft("delivery");
  draft.pricingMethod = "quote";
  draft.customerName = "Ada";
  draft.customerPhone = "555";
  draft.customerEmail = "ada@example.com";
  draft.hearAbout = "facebook";
  assert.match(validateStep("verify", draft).customerPhone ?? "", /10-digit/);
  draft.customerPhone = "404-555-1212";
  draft.agreedToTerms = true;
  assert.equal(validateStep("verify", draft).customerPhone, undefined);
  assert.equal(validateStep("verify", draft).customerEmail, undefined);
});

test("every service requires an email before the request is saved", () => {
  const services = ["delivery", "free_item", "junk", "construction"] as const;
  for (const service of services) {
    const draft = emptyDraft(service);
    draft.customerName = "Ada Lovelace";
    draft.customerPhone = "4045551212";
    draft.agreedToTerms = true;
    draft.customerEmail = "";
    assert.equal(
      validateStep("verify", draft, { signedIn: true }).customerEmail,
      "Please enter your email address.",
    );
    draft.customerEmail = "   ";
    assert.equal(
      validateStep("verify", draft, { signedIn: true }).customerEmail,
      "Please enter your email address.",
    );
    draft.customerEmail = "not-an-email";
    assert.equal(
      validateStep("verify", draft, { signedIn: true }).customerEmail,
      "Please enter a valid email address.",
    );
    draft.customerEmail = "  ada@example.com  ";
    const valid = validateStep("verify", draft, { signedIn: true });
    assert.equal(valid.customerEmail, undefined);
    assert.equal(Object.keys(validateStep("verify", { ...draft, customerEmail: "" }, { signedIn: true }))[0], "customerEmail");
    assert.equal(draft.customerName, "Ada Lovelace");
    assert.equal(draft.customerPhone, "4045551212");
  }
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
