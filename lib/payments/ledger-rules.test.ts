import assert from "node:assert/strict";
import test from "node:test";
import { captureCents, ledgerAfterRefund } from "./ledger-rules";

test("a full capture takes the customer total", () => {
  assert.equal(captureCents({ kind: "full", priceCents: 5175, tripFeeCents: 2500 }), 5175);
});

test("a rejected item captures only the trip fee", () => {
  assert.equal(captureCents({ kind: "trip", priceCents: 5175, tripFeeCents: 2500 }), 2500);
});

test("a partial refund before transfer reduces the ledger and creates no recovery", () => {
  assert.deepEqual(ledgerAfterRefund({ transferred: false, ledgerCents: 8000, refundCents: 2000 }), {
    ledgerCents: 6000,
    recoveryCents: 0,
  });
});

test("a refund after transfer keeps the ledger and records a recovery", () => {
  assert.deepEqual(ledgerAfterRefund({ transferred: true, ledgerCents: 8000, refundCents: 2000 }), {
    ledgerCents: 8000,
    recoveryCents: 2000,
  });
});
