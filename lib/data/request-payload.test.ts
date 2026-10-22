import assert from "node:assert/strict";
import test from "node:test";
import { emptyDraft } from "../types";
import { requestPayload } from "./request-payload";

function ready(service: "delivery" | "junk" | "free_item" | "construction" = "delivery") {
  const draft = emptyDraft(service);
  draft.description = "Oak dresser";
  draft.pieces = "1";
  draft.size = "medium";
  draft.itemValue = "80";
  draft.pickupStreet = "10 Secret Street";
  draft.pickupCity = "Austell";
  draft.pickupZip = "30106";
  draft.stairsPickup = "0";
  draft.elevator = "no";
  draft.helpLoading = "yes";
  draft.preferredDate = "asap";
  draft.pricingMethod = "quote";
  draft.customerName = "Ada Lovelace";
  draft.customerPhone = "4045551212";
  draft.hearAbout = "nextdoor";
  draft.agreedToTerms = true;
  if (service === "delivery") {
    draft.alreadyPaid = "yes";
    draft.sellerHolding = "yes";
    draft.wantsItemCheck = "yes";
  }
  if (service !== "junk") {
    draft.dropoffStreet = "20 Hidden Avenue";
    draft.dropoffCity = "Smyrna";
    draft.dropoffZip = "30080";
    draft.stairsDropoff = "0";
  }
  if (service === "junk") {
    draft.junkLoadSize = "quarter";
    draft.junkMaterials = "Wood furniture";
  }
  if (service === "construction") {
    draft.storeName = "Home Depot";
  }
  return draft;
}

test("a quote payload has no customer price and no booking fields", () => {
  const payload = requestPayload(ready());
  assert.equal(payload.pricing_method, "quote");
  assert.equal(payload.offer_cents, null);
  assert.equal(payload.budget_min_cents, null);
  assert.equal(payload.budget_max_cents, null);
  assert.equal("price_cents" in payload, false);
  assert.equal("driver_pay_cents" in payload, false);
  assert.equal("status" in payload, false);
  assert.equal("customer_id" in payload, false);
  assert.equal(payload.customer_phone, "+14045551212");
  assert.equal(payload.pickup_area, "Austell, 30106");
  assert.equal(String(payload.pickup_address).includes("Secret"), true);
});

test("fixed and range payloads keep only that method's amounts", () => {
  const fixed = ready();
  fixed.pricingMethod = "fixed";
  fixed.offerDollars = "40";
  const fixedPayload = requestPayload(fixed);
  assert.equal(fixedPayload.offer_cents, 4000);
  assert.equal(fixedPayload.budget_min_cents, null);

  const range = ready();
  range.pricingMethod = "range";
  range.budgetMinDollars = "40";
  range.budgetMaxDollars = "80";
  const rangePayload = requestPayload(range);
  assert.equal(rangePayload.offer_cents, null);
  assert.equal(rangePayload.budget_min_cents, 4000);
  assert.equal(rangePayload.budget_max_cents, 8000);
});

test("junk omits drop-off and the other services keep it", () => {
  const junk = requestPayload(ready("junk"));
  assert.equal(junk.dropoff_address, null);
  assert.equal(junk.dropoff_area, null);
  assert.equal(junk.junk_load_size, "quarter");

  const construction = requestPayload(ready("construction"));
  assert.equal(construction.store_name, "Home Depot");
  assert.equal(construction.dropoff_address, "20 Hidden Avenue");
});
