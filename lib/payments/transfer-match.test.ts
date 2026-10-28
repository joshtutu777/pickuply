import assert from "node:assert/strict";
import test from "node:test";
import { isLedgerEntryId, nextTransferStep, transferForLedger, transferIdempotencyKey } from "./transfer-match";

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
});
