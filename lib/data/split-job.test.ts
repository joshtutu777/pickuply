import assert from "node:assert/strict";
import test from "node:test";
import { splitJob } from "./split-job";
import { emptyDraft } from "../types";
import { toStoredDraft } from "../draft";

function readyDraft() {
  const draft = emptyDraft("delivery");
  draft.description = "Oak dresser";
  draft.pieces = "1";
  draft.size = "large";
  draft.itemValue = "1500";
  draft.alreadyPaid = "yes";
  draft.sellerHolding = "no";
  draft.wantsItemCheck = "yes";
  draft.pickupStreet = "1 Secret St";
  draft.pickupCity = "Austell";
  draft.pickupZip = "30106";
  draft.dropoffStreet = "9 Hidden Ave";
  draft.dropoffCity = "Smyrna";
  draft.dropoffZip = "30080";
  draft.accessNotes = "Gate 1234";
  draft.stairsPickup = "1";
  draft.stairsDropoff = "0";
  draft.elevator = "no";
  draft.helpLoading = "yes";
  draft.preferredDate = "today";
  draft.timeWindow = "morning";
  draft.pricingMethod = "fixed";
  draft.offerDollars = "90";
  draft.customerName = "Ada Lovelace";
  draft.customerPhone = "(404) 555-1212";
  draft.customerEmail = "ada@example.com";
  draft.hearAbout = "friend";
  draft.agreedToTerms = true;
  return draft;
}

test("public jobs omit addresses, name, phone, email, and access notes", () => {
  const draft = readyDraft();
  const { job, privateJob } = splitJob(draft, "job-1", ["photo-1"], "2026-10-21T12:00:00.000Z");
  const publicText = JSON.stringify(job);
  assert.equal(publicText.includes("Secret"), false);
  assert.equal(publicText.includes("Hidden"), false);
  assert.equal(publicText.includes("4045551212"), false);
  assert.equal(publicText.includes("ada@example.com"), false);
  assert.equal(publicText.includes("Ada Lovelace"), false);
  assert.equal(publicText.includes("Gate 1234"), false);
  assert.equal(job.pickup_area, "Austell, 30106");
  assert.equal(job.zone_id, "west_metro");
  assert.equal(job.needs_value_approval, true);
  assert.equal(job.pricing_method, "fixed");
  assert.equal(job.offer_cents, 9000);
  assert.equal(job.budget_min_cents, null);
  assert.equal(privateJob.customer_phone, "+14045551212");
  assert.equal(privateJob.pickup_address, "1 Secret St");
  assert.equal(privateJob.customer_email, "ada@example.com");
});

test("quote and range amounts are stored without changing the method", () => {
  const quote = readyDraft();
  quote.pricingMethod = "quote";
  quote.offerDollars = "200";
  const quoted = splitJob(quote, "job-2", []).job;
  assert.equal(quoted.pricing_method, "quote");
  assert.equal(quoted.offer_cents, null);

  const range = readyDraft();
  range.pricingMethod = "range";
  range.budgetMinDollars = "40";
  range.budgetMaxDollars = "80";
  const ranged = splitJob(range, "job-3", []).job;
  assert.equal(ranged.pricing_method, "range");
  assert.equal(ranged.budget_min_cents, 4000);
  assert.equal(ranged.budget_max_cents, 8000);
  assert.equal(ranged.offer_cents, null);
});

test("a stored draft drops phone, email, and street addresses but keeps the item", () => {
  const stored = toStoredDraft(readyDraft(), ["photo-1"], "2026-10-21T12:00:00.000Z");
  assert.equal(stored.draft.pickupStreet, "");
  assert.equal(stored.draft.dropoffStreet, "");
  assert.equal(stored.draft.customerPhone, "");
  assert.equal(stored.draft.customerEmail, "");
  assert.equal(stored.draft.description, "Oak dresser");
  assert.equal(stored.draft.customerName, "Ada Lovelace");
  assert.equal(stored.draft.pickupCity, "Austell");
  assert.deepEqual(stored.photoIds, ["photo-1"]);
});
