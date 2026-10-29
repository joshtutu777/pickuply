import assert from "node:assert/strict";
import test from "node:test";
import { isLedgerEntryId, lookupErrorKind, lookupFailureAction, nextTransferStep, selectLedgerTransfer, transferForLedger, transferIdempotencyKey } from "./transfer-match";

const entry = "c0990000-0000-4000-8000-000000000021";

test("an existing Stripe transfer is reused for the same ledger row", () => {
  assert.equal(isLedgerEntryId(entry), true);
  assert.equal(isLedgerEntryId("not-an-id"), false);
  assert.equal(
    transferForLedger(
      [
        { id: "tr_other", metadata: { ledger_id: "c0990000-0000-4000-8000-000000000099" } },
        { id: "tr_saved", metadata: { ledger_id: entry } },
      ],
      entry,
    ),
    "tr_saved",
  );
  assert.equal(transferForLedger([{ id: "tr_saved", metadata: { ledger_id: entry } }], "not-an-id"), null);
  assert.equal(transferForLedger([{ id: "py_saved", metadata: { ledger_id: entry } }], entry), null);
  assert.equal(transferIdempotencyKey(entry), entry);
  assert.equal(transferIdempotencyKey("not-an-id"), null);
  assert.equal(nextTransferStep("send", "absent"), "create");
  assert.equal(nextTransferStep("send", "found"), "record");
  assert.equal(nextTransferStep("send", "unknown"), "wait");
  assert.equal(nextTransferStep("lookup", "absent"), "confirm");
  assert.equal(nextTransferStep("lookup", "unknown"), "wait");
  assert.equal(nextTransferStep("reconcile", "absent"), "reconcile");
  assert.equal(nextTransferStep("recorded", "absent"), "record");
  assert.equal(transferForLedger([{ id: "tr_grouped", transfer_group: entry }], entry), "tr_grouped");
  assert.equal(
    transferForLedger([{ id: "tr_othergroup", transfer_group: "c0990000-0000-4000-8000-000000000099", metadata: { ledger_id: entry } }], entry),
    null,
  );
});

test("a successful lookup records a found transfer and creates only when none exists", () => {
  assert.equal(nextTransferStep("send", "found"), "record");
  assert.equal(nextTransferStep("lookup", "found"), "record");
  assert.equal(nextTransferStep("send", "absent"), "create");
  assert.equal(nextTransferStep("send", "unknown"), "wait");
});

test("lookup errors retry, and the third try depends on the 23-hour boundary", () => {
  const first = new Date("2026-10-28T12:00:00.000Z");
  const inside = new Date(first.getTime() + 23 * 60 * 60 * 1000 - 1);
  const exact = new Date(first.getTime() + 23 * 60 * 60 * 1000);
  assert.equal(lookupFailureAction({ attempts: 1, firstAttemptAt: first, now: inside, kind: "transient" }), "retry");
  assert.equal(lookupFailureAction({ attempts: 2, firstAttemptAt: first, now: inside, kind: "transient" }), "retry");
  assert.equal(lookupFailureAction({ attempts: 3, firstAttemptAt: first, now: inside, kind: "transient" }), "create");
  assert.equal(lookupFailureAction({ attempts: 3, firstAttemptAt: first, now: exact, kind: "transient" }), "reconcile");
  assert.equal(
    lookupFailureAction({ attempts: 3, firstAttemptAt: first, now: new Date(exact.getTime() + 1000), kind: "transient" }),
    "reconcile",
  );
  assert.equal(lookupFailureAction({ attempts: 3, firstAttemptAt: null, now: exact, kind: "transient" }), "reconcile");
});

test("a configuration error is alerted and is not a retry", () => {
  const now = new Date("2026-10-29T12:00:00.000Z");
  assert.equal(lookupErrorKind({ type: "StripeAuthenticationError", statusCode: 401 }), "configuration");
  assert.equal(lookupErrorKind({ type: "StripePermissionError", statusCode: 403, code: "account_invalid" }), "configuration");
  assert.equal(lookupErrorKind({ message: "Invalid API key provided" }), "configuration");
  assert.equal(lookupErrorKind({ type: "StripeConnectionError", statusCode: 500 }), "transient");
  assert.equal(
    lookupFailureAction({ attempts: 1, firstAttemptAt: now, now, kind: "configuration" }),
    "alert",
  );
});

test("a legacy transfer without a transfer group is found by ledger metadata", () => {
  const legacy = { id: "tr_legacy", metadata: { ledger_id: entry } };
  assert.equal(selectLedgerTransfer([], [legacy], entry), "tr_legacy");
  assert.equal(selectLedgerTransfer([{ id: "tr_grouped", transfer_group: entry }], [legacy], entry), "tr_grouped");
  assert.equal(
    selectLedgerTransfer([], [{ id: "tr_other", metadata: { ledger_id: "c0990000-0000-4000-8000-000000000099" } }], entry),
    null,
  );
});
