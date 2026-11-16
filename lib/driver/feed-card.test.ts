import assert from "node:assert/strict";
import test from "node:test";
import {
  cardButtonLabel,
  detailsButtonLabel,
  fromYouLabel,
  helperNeedLabel,
  hiddenUntilAssigned,
  itemPhotoLabel,
  itemSummary,
  jobTypeLabel,
  latestOfferByJob,
  notificationBadge,
  offerAmountCents,
  offerButtonLabel,
  offerCardLine,
  offerDraftReady,
  offerFieldLabel,
  offerStatusLabel,
  peopleLabel,
  pickupTimeLabel,
  placeLabel,
  routeLabel,
  stairsLabel,
  structuredItemFacts,
  tripDistanceLabel,
  unavailableJobTitle,
  vehicleNeedLabel,
} from "./feed-card";

test("a job card uses the service name and the structured item, not a free-text note", () => {
  assert.equal(jobTypeLabel("delivery"), "Pickup & Delivery");
  assert.equal(jobTypeLabel("junk"), "Junk Removal & Hauling");
  assert.equal(itemSummary(1, "large"), "1 piece · large");
  assert.equal(itemSummary(3, "medium"), "3 pieces · medium");
});

test("places, distance, vehicle, helper, and pickup time stay readable", () => {
  assert.equal(placeLabel("Atlanta, 30305", "pickup"), "Atlanta, 30305");
  assert.equal(placeLabel(null, "dropoff"), "No drop-off");
  assert.equal(routeLabel("Atlanta, 30305", "Marietta, 30060"), "Atlanta to Marietta");
  assert.equal(routeLabel("30305", null), "30305 to No drop-off");
  assert.equal(tripDistanceLabel(12.5), "12.5 mi trip");
  assert.equal(tripDistanceLabel(null), "Trip distance not listed");
  assert.equal(fromYouLabel(3.2), "About 3 mi from you");
  assert.equal(vehicleNeedLabel("box_truck"), "Box truck");
  assert.equal(vehicleNeedLabel(null), "Any vehicle");
  assert.equal(peopleLabel(true), "2 people");
  assert.equal(peopleLabel(false), "1 person");
  assert.equal(stairsLabel(0, 0), "No stairs reported");
  assert.equal(helperNeedLabel(true, 1, 0), "Helper needed · 1 at pickup, 0 at drop-off");
  assert.equal(helperNeedLabel(false, 0, 0), "No helper needed · No stairs reported");
  assert.equal(pickupTimeLabel("asap", "morning"), "As soon as possible · Morning");
});

test("the dashboard button and the offer form keep their labels, and private text stays off the card", () => {
  assert.equal(detailsButtonLabel, "View Details & Send Offer");
  assert.equal(offerFieldLabel, "Your Offer ($)");
  assert.equal(offerButtonLabel, "Submit Offer");
  assert.match(hiddenUntilAssigned, /street address stay hidden/);
  assert.equal(hiddenUntilAssigned.includes("30305"), false);
});

test("item facts use the structured fields and leave out the written description", () => {
  const facts = structuredItemFacts({
    service: "delivery",
    pieces: 2,
    size: "large",
    helpLoading: true,
    stairsPickup: 1,
    stairsDropoff: 0,
    elevator: false,
  });
  assert.deepEqual(facts, {
    type: "Pickup & Delivery",
    quantity: "2 pieces",
    size: "Large",
    handling: "2 people · 1 at pickup, 0 at drop-off · No elevator reported",
  });
  assert.equal(JSON.stringify(facts).includes("description"), false);
  assert.equal(itemPhotoLabel(0), "No item photos");
  assert.equal(itemPhotoLabel(2), null);
  assert.equal(unavailableJobTitle, "This request is no longer available");
});

test("a saved offer shows its stored status and the offer amount", () => {
  assert.equal(offerCardLine("active", 9500), "Offer Sent — $95");
  assert.equal(offerCardLine("chosen", 9500), "Offer Chosen — $95");
  assert.equal(offerCardLine("expired", 9500), "Offer Expired — $95");
  assert.equal(offerCardLine("withdrawn", 9500), "Offer Withdrawn — $95");
  assert.equal(offerCardLine("declined", 9500), "Offer Declined — $95");
  assert.equal(offerStatusLabel("expired"), "Offer Expired");
  assert.notEqual(offerStatusLabel("expired"), "Offer Sent");
  assert.notEqual(offerStatusLabel("withdrawn"), "Offer Sent");
  assert.equal(offerAmountCents(8075, 1425), 9500);
  assert.equal(cardButtonLabel(false), "View Details & Send Offer");
  assert.equal(cardButtonLabel(true), "View Request Details");
  const latest = latestOfferByJob([
    { jobId: "job-1", status: "expired", driverAmountCents: 4000, platformFeeCents: 0, createdAt: "2026-11-15T12:00:00Z" },
    { jobId: "job-1", status: "active", driverAmountCents: 8000, platformFeeCents: 1500, createdAt: "2026-11-15T18:00:00Z" },
    { jobId: "job-2", status: "withdrawn", driverAmountCents: 5000, platformFeeCents: 0, createdAt: "2026-11-15T13:00:00Z" },
  ]);
  assert.equal(latest.get("job-1")?.status, "active");
  assert.equal(latest.get("job-2")?.status, "withdrawn");
});

test("the offer button needs an amount, and a low amount still reaches the database minimum check", () => {
  assert.equal(offerDraftReady(0), false);
  assert.equal(offerDraftReady(3499), true);
  assert.equal(offerDraftReady(3500), true);
});

test("the alerts badge shows the unread count and caps at 9+", () => {
  assert.equal(notificationBadge(0), null);
  assert.equal(notificationBadge(1), "1");
  assert.equal(notificationBadge(9), "9");
  assert.equal(notificationBadge(10), "9+");
  assert.equal(notificationBadge(24), "9+");
});
