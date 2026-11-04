import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  isNextRedirect,
  payoutSetupErrorMessage,
  redactPayoutSetupMessage,
  reportPayoutSetupFailure,
  stripeErrorDetails,
  stripeOnboardingUrl,
} from "./payout-setup-result";

test("payout setup errors stay short and leave out secrets", () => {
  assert.match(payoutSetupErrorMessage(new Error("Payments are paused. Try again in a few minutes.")), /paused/);
  assert.match(payoutSetupErrorMessage(new Error("The payout account could not be saved.")), /could not be saved/);
  assert.match(payoutSetupErrorMessage(new Error("Live payments are not configured.")), /not available right now/);
  assert.equal(
    payoutSetupErrorMessage(new Error("No such account: acct_123 sk_live_secret")),
    "Payout setup could not be started. Try again in a moment.",
  );
  assert.equal(payoutSetupErrorMessage("nope"), "Payout setup could not be started. Try again in a moment.");
  assert.equal(
    payoutSetupErrorMessage(new Error("If dashboard is express, fees_collector must be application.")),
    "Payout setup could not be started. Try again in a moment.",
  );
});

test("a payout failure log names the stage and leaves out account details", () => {
  const stripeError = Object.assign(new Error("No such account: acct_123 for driver@example.com sk_live_secret"), {
    type: "invalid_request_error",
    code: "account_invalid",
    statusCode: 400,
  });
  assert.deepEqual(stripeErrorDetails(stripeError), {
    name: "Error",
    type: "invalid_request_error",
    code: "account_invalid",
    status: 400,
  });
  assert.equal(
    redactPayoutSetupMessage(stripeError.message),
    "No such account: acct_[id] for [email] [key]",
  );
  const lines: string[] = [];
  const original = console.error;
  console.error = (line: unknown) => {
    lines.push(String(line));
  };
  try {
    reportPayoutSetupFailure("stripe_account_create", stripeError);
    reportPayoutSetupFailure("account_save", stripeError);
  } finally {
    console.error = original;
  }
  assert.equal(lines.length, 1);
  const logged = JSON.parse(lines[0]) as { stage: string; error_code: string; error_message: string };
  assert.equal(logged.stage, "stripe_account_create");
  assert.equal(logged.error_code, "account_invalid");
  assert.equal(logged.error_message.includes("acct_123"), false);
  assert.equal(logged.error_message.includes("sk_live"), false);
  assert.equal(logged.error_message.includes("driver@example.com"), false);
});

test("only a Stripe hosted onboarding link can leave Pickuply", () => {
  assert.equal(stripeOnboardingUrl("https://connect.stripe.com/setup/e/acct_123/token"), "https://connect.stripe.com/setup/e/acct_123/token");
  assert.equal(stripeOnboardingUrl("https://example.com/setup"), null);
  assert.equal(stripeOnboardingUrl("http://connect.stripe.com/setup"), null);
  assert.equal(stripeOnboardingUrl("not a url"), null);
});

test("a login redirect is not shown as a payout failure", () => {
  assert.equal(isNextRedirect({ digest: "NEXT_REDIRECT;replace;/login;307;" }), true);
  assert.equal(isNextRedirect(new Error("Stripe is down")), false);
});

test("the payout button shows progress and does not open a second account path", () => {
  const button = readFileSync(new URL("../../components/driver/payout-setup-button.tsx", import.meta.url), "utf8");
  const actions = readFileSync(new URL("../../app/driver/connect/actions.ts", import.meta.url), "utf8");
  const connect = readFileSync(new URL("./connect.ts", import.meta.url), "utf8");
  assert.match(button, /Opening Stripe\.\.\./);
  assert.match(button, /disabled=\{pending\}/);
  assert.match(button, /role="alert"/);
  assert.match(button, /window\.location\.assign\(url\)/);
  assert.match(button, /if \(pending\) return/);
  assert.match(actions, /ensureExpressAccount\(driver\.userId, driver\.accountId\)/);
  assert.match(connect, /if \(existingId\)/);
  assert.match(connect, /return existingId/);
  assert.match(connect, /idempotencyKey: `connect-account:\$\{driverId\}`/);
  assert.match(connect, /reportPayoutSetupFailure\("stripe_account_create"/);
  assert.match(connect, /reportPayoutSetupFailure\("account_save"/);
  assert.match(connect, /reportPayoutSetupFailure\("stripe_account_link"/);
  assert.match(actions, /reportPayoutSetupFailure\("driver_lookup"/);
});
