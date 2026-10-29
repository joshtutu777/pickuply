import assert from "node:assert/strict";
import test from "node:test";
import { offPlatformWarning, redirectsPayment } from "./payment-redirect";

test("ordinary job messages stay allowed", () => {
  assert.equal(redirectsPayment("Pickup at 123 Main Street."), false);
  assert.equal(redirectsPayment("The price is $75."), false);
  assert.equal(redirectsPayment("Two chairs and one table."), false);
  assert.equal(redirectsPayment("Can you pick up the table tomorrow?"), false);
  assert.equal(redirectsPayment("I have cash for the toll."), false);
  assert.equal(redirectsPayment("The paycheck is not part of this job."), false);
});

test("off-platform payment requests are blocked", () => {
  assert.equal(offPlatformWarning, "Payments must go through Pickuply so you're protected.");
  assert.equal(redirectsPayment("Venmo me the rest"), true);
  assert.equal(redirectsPayment("Send it on Cash App"), true);
  assert.equal(redirectsPayment("cashapp is easier"), true);
  assert.equal(redirectsPayment("Zelle the balance"), true);
  assert.equal(redirectsPayment("I can PayPal you"), true);
  assert.equal(redirectsPayment("Please pay cash"), true);
  assert.equal(redirectsPayment("Can you pay me directly"), true);
});
