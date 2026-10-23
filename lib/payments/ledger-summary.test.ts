import assert from "node:assert/strict";
import test from "node:test";
import { ledgerBuckets } from "./ledger-summary";

test("completed, pending, and transferred earnings stay separate", () => {
  assert.deepEqual(
    ledgerBuckets([
      { status: "pending", amount_cents: 1000 },
      { status: "held_until_onboarding", amount_cents: 2000 },
      { status: "transferred", amount_cents: 4000 },
      { status: "externally_paid", amount_cents: 500 },
      { status: "recovery_due", amount_cents: 900 },
    ]),
    { completedCents: 7500, pendingCents: 3000, transferredCents: 4000 },
  );
});
