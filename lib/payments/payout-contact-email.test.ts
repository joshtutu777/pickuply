import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { PAYOUT_EMAIL_REQUIRED, payoutContactEmail } from "./payout-contact-email";

test("a confirmed sign-in email is sent to Stripe", () => {
  assert.equal(
    payoutContactEmail({
      authEmail: "  Driver@Example.com ",
      authEmailConfirmed: true,
      profileEmail: "other@example.com",
    }),
    "driver@example.com",
  );
});

test("a phone driver can use a valid profile email", () => {
  assert.equal(
    payoutContactEmail({
      authEmail: null,
      authEmailConfirmed: false,
      profileEmail: "  Phone.Driver@Example.com ",
    }),
    "phone.driver@example.com",
  );
});

test("a driver with neither email is stopped before Stripe", () => {
  assert.equal(payoutContactEmail({ authEmail: null, authEmailConfirmed: false, profileEmail: null }), null);
  assert.equal(payoutContactEmail({ authEmail: "   ", authEmailConfirmed: true, profileEmail: "" }), null);
  assert.equal(PAYOUT_EMAIL_REQUIRED, "Add your email address to your driver profile before setting up payouts.");
});

test("an invalid or unconfirmed email is not sent", () => {
  assert.equal(
    payoutContactEmail({
      authEmail: "not-an-email",
      authEmailConfirmed: true,
      profileEmail: "also bad",
    }),
    null,
  );
  assert.equal(
    payoutContactEmail({
      authEmail: "driver@example.com",
      authEmailConfirmed: false,
      profileEmail: "not-an-email",
    }),
    null,
  );
  assert.equal(
    payoutContactEmail({
      authEmail: "driver@example.com",
      authEmailConfirmed: false,
      profileEmail: "profile@example.com",
    }),
    "profile@example.com",
  );
});

test("a missing email is rejected before account creation, and an existing account is reused", () => {
  const connect = readFileSync(new URL("./connect.ts", import.meta.url), "utf8");
  const setup = connect.slice(connect.indexOf("export async function ensureExpressAccount"));
  const existingAt = setup.indexOf("if (existingId)");
  const requiredAt = setup.indexOf("PAYOUT_EMAIL_REQUIRED");
  const createAt = setup.indexOf("v2.core.accounts.create");
  assert.ok(existingAt >= 0 && existingAt < requiredAt && requiredAt < createAt);
  assert.match(setup, /contact_email: email/);
  assert.match(setup, /idempotencyKey: `connect-account:\$\{driverId\}`/);
  assert.match(setup, /fees_collector: "stripe"/);
  assert.match(setup, /losses_collector: "stripe"/);
  assert.equal(setup.includes("example.com"), false);
  const earnings = readFileSync(new URL("../../app/driver/earnings/page.tsx", import.meta.url), "utf8");
  assert.match(earnings, /startPayoutSetup/);
});
