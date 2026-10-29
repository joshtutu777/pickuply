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

test("a failed lookup retries twice and then reconciles without creating", () => {
  assert.equal(lookupFailureAction({ attempts: 1, kind: "transient" }), "retry");
  assert.equal(lookupFailureAction({ attempts: 2, kind: "transient" }), "retry");
  assert.equal(lookupFailureAction({ attempts: 3, kind: "transient" }), "reconcile");
  assert.equal(lookupFailureAction({ attempts: 4, kind: "transient" }), "reconcile");
});

test("a configuration error is alerted and is not a retry", () => {
  assert.equal(lookupErrorKind({ type: "StripeAuthenticationError", statusCode: 401 }), "configuration");
  assert.equal(lookupErrorKind({ type: "StripePermissionError", statusCode: 403, code: "account_invalid" }), "configuration");
  assert.equal(lookupErrorKind({ message: "Invalid API key provided" }), "configuration");
  assert.equal(lookupErrorKind({ type: "StripeConnectionError", statusCode: 500 }), "transient");
  assert.equal(
    lookupFailureAction({ attempts: 1, kind: "configuration" }),
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
