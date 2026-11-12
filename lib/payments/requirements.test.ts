import assert from "node:assert/strict";
import test from "node:test";
import { payoutSetupLabel, requirementLabels } from "./requirements";

test("stripe requirement keys become plain labels", () => {
  assert.deepEqual(
    requirementLabels(["external_account", "individual.verification.document", "something.new"]),
    ["A bank account", "A photo ID", "More details in Stripe"],
  );
});

test("payout setup wording follows Stripe's flags", () => {
  assert.equal(payoutSetupLabel(null), "Set up payouts");
  assert.equal(
    payoutSetupLabel({ payouts_enabled: false, transfers_active: false, details_submitted: false }),
    "Finish payout setup",
  );
  assert.equal(
    payoutSetupLabel({ payouts_enabled: true, transfers_active: false, details_submitted: true }),
    "Finish payout setup",
  );
  assert.equal(
    payoutSetupLabel({ payouts_enabled: true, transfers_active: true, details_submitted: true }),
    "Payouts are ready",
  );
});
