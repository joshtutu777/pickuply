import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { afterCreateResult, classifyTransferError, recoverTransfer } from "./transfer-recovery";
import { settleOneTransfer, type TransferGate, type TransferPorts } from "./transfer-settle";
import { createLedgerTransfer, type ListedTransfer, type TransferCreator, type TransferSearch } from "./transfer-stripe";

const entryId = "11111111-1111-4111-8111-111111111111";
const destination = "acct_driver";
const chargeId = "ch_example";

type Memory = {
  transfers: ListedTransfer[];
  creates: string[];
  failed: string | null;
  setup: boolean;
  outcomes: string[];
  audits: string[];
  stored: string | null;
  state: "open" | "sending" | "ambiguous" | "recorded";
  key: string;
  failureKind: "funding" | "permanent" | "uncertain" | null;
  confirmCalls: number;
  confirmOpens: boolean;
  failLookup: boolean;
  truncate: boolean;
  createError: null | { type?: string; code?: string; message: string; storeFirst?: boolean };
};

function memory(partial?: Partial<Memory>) {
  const state: Memory = {
    transfers: [],
    creates: [],
    failed: null,
    setup: false,
    outcomes: [],
    audits: [],
    stored: null,
    state: "open",
    key: entryId,
    failureKind: null,
    confirmCalls: 0,
    confirmOpens: false,
    failLookup: false,
    truncate: false,
    createError: null,
    ...partial,
  };
  const search: TransferSearch = {
    async list(params) {
      if (state.failLookup) throw new Error("lookup down");
      if (state.truncate && params.transfer_group) return { data: [], has_more: true };
      let data = state.transfers.filter((item) =>
        params.transfer_group ? item.transfer_group === params.transfer_group : Boolean(params.destination),
      );
      if (params.starting_after) {
        const index = data.findIndex((item) => item.id === params.starting_after);
        data = index >= 0 ? data.slice(index + 1) : [];
      }
      return { data: data.slice(0, params.limit), has_more: data.length > params.limit };
    },
  };
  const creator: TransferCreator = {
    async create(params, options) {
      state.creates.push(options.idempotencyKey);
      assert.equal(params.transfer_group, entryId);
      assert.equal(params.metadata.ledger_id, entryId);
      if (state.createError?.storeFirst) {
        state.transfers.push({
          id: "tr_LostResponse",
          transfer_group: params.transfer_group,
          metadata: params.metadata,
        });
      }
      if (state.createError) {
        const error = new Error(state.createError.message);
        Object.assign(error, state.createError);
        throw error;
      }
      const existing = state.transfers.find((item) => item.metadata?.ledger_id === entryId);
      if (existing) return { id: existing.id };
      state.transfers.push({
        id: "tr_CreatedOnce",
        transfer_group: params.transfer_group,
        metadata: params.metadata,
      });
      return { id: "tr_CreatedOnce" };
    },
  };
  const ports: TransferPorts = {
    async begin(confirmAbsent): Promise<TransferGate | null> {
      if (confirmAbsent) state.confirmCalls += 1;
      if (state.stored) {
        return { action: "recorded", transferId: state.stored, idempotencyKey: state.key, failureKind: state.failureKind };
      }
      if (state.state === "open" && !confirmAbsent) {
        state.state = "sending";
        return { action: "send", transferId: null, idempotencyKey: state.key, failureKind: state.failureKind };
      }
      if (confirmAbsent && state.confirmOpens && (state.state === "sending" || state.state === "ambiguous")) {
        state.state = "sending";
        return { action: "send", transferId: null, idempotencyKey: state.key, failureKind: state.failureKind };
      }
      return { action: "lookup", transferId: null, idempotencyKey: state.key, failureKind: state.failureKind };
    },
    async record(transferId) {
      if (state.stored && state.stored !== transferId) return false;
      state.stored = transferId;
      state.state = "recorded";
      return true;
    },
    async noteUnknown() {
      if (state.state === "sending") state.state = "ambiguous";
    },
    async noteOutcome(kind) {
      state.outcomes.push(kind);
      state.failureKind = kind;
    },
    async markFailed(reason) {
      state.failed = reason;
    },
    async audit(reason) {
      state.audits.push(reason);
    },
  };
  return {
    get transfers() {
      return state.transfers;
    },
    get creates() {
      return state.creates;
    },
    get failed() {
      return state.failed;
    },
    get outcomes() {
      return state.outcomes;
    },
    get audits() {
      return state.audits;
    },
    get stored() {
      return state.stored;
    },
    get confirmCalls() {
      return state.confirmCalls;
    },
    reopenClaim() {
      state.state = "open";
    },
    set createError(value: Memory["createError"]) {
      state.createError = value;
    },
    search,
    creator,
    ports,
    settle: (input?: Partial<Parameters<typeof settleOneTransfer>[0]>) =>
      settleOneTransfer({
        entryId,
        amountCents: 2975,
        destination,
        chargeId,
        paymentLivemode: true,
        accountLivemode: true,
        workerLivemode: true,
        ledgerTransferId: state.stored,
        allowCreate: true,
        search,
        creator,
        ports,
        ...input,
      }),
  };
}

test("A. a successful response is recorded once", async () => {
  const gate = memory();
  const result = await gate.settle();
  assert.equal(result.outcome, "created");
  assert.deepEqual(gate.creates, [entryId]);
  assert.equal(gate.stored, "tr_CreatedOnce");
});

test("B. a lost successful response is recovered by lookup", async () => {
  const gate = memory({ createError: { type: "StripeConnectionError", message: "socket hang up", storeFirst: true } });
  const lost = await gate.settle();
  assert.equal(lost.outcome, "held");
  assert.equal(gate.failed, null);
  gate.createError = null;
  const recovered = await gate.settle({ ledgerTransferId: null });
  assert.equal(recovered.outcome, "recorded");
  assert.deepEqual(gate.creates, [entryId]);
  assert.equal(gate.stored, "tr_LostResponse");
});

test("a confirmed refusal is not sent again", async () => {
  const gate = memory({
    createError: { type: "StripeInvalidRequestError", code: "balance_insufficient", message: "insufficient funds" },
    confirmOpens: true,
  });
  const first = await gate.settle();
  assert.equal(first.outcome, "refused");
  assert.equal(gate.failed !== null, true);
  gate.createError = null;
  gate.reopenClaim();
  const second = await gate.settle({ ledgerTransferId: null });
  assert.equal(second.outcome, "held");
  assert.deepEqual(gate.creates, [entryId]);
  assert.equal(gate.transfers.length, 0);
  assert.equal(gate.confirmCalls, 0);
});

test("C. a retry after a recorded transfer does not create another", async () => {
  const gate = memory({ stored: "tr_CreatedOnce", state: "recorded" });
  const result = await gate.settle();
  assert.equal(result.outcome, "recorded");
  assert.deepEqual(gate.creates, []);
});

test("D. a timeout does not become a second transfer", async () => {
  const gate = memory({
    createError: { type: "StripeConnectionError", message: "timeout" },
    confirmOpens: true,
  });
  const first = await gate.settle();
  assert.equal(first.outcome, "held");
  assert.equal(gate.failed, null);
  assert.equal(gate.outcomes.includes("uncertain"), true);
  gate.createError = null;
  gate.transfers.splice(0, gate.transfers.length);
  gate.reopenClaim();
  const second = await gate.settle({ ledgerTransferId: null });
  assert.equal(second.outcome, "held");
  assert.deepEqual(gate.creates, [entryId]);
  assert.equal(gate.transfers.length, 0);
  assert.equal(gate.confirmCalls, 0);
});

test("E. an existing ledger transfer is kept and not sent again", async () => {
  const gate = memory();
  const result = await gate.settle({ ledgerTransferId: "tr_AlreadyThere" });
  assert.equal(result.outcome, "recorded");
  assert.equal(gate.stored, "tr_AlreadyThere");
  assert.deepEqual(gate.creates, []);
});

test("F. two workers share one transfer", async () => {
  const gate = memory();
  let release: () => void = () => {};
  const started = new Promise<void>((resolve) => {
    release = resolve;
  });
  const original = gate.creator.create;
  gate.creator.create = async (params, options) => {
    await started;
    return original(params, options);
  };
  const first = gate.settle();
  const second = gate.settle();
  await new Promise((resolve) => setTimeout(resolve, 20));
  release();
  const results = await Promise.all([first, second]);
  assert.equal(results.filter((item) => item.outcome === "created").length, 1);
  assert.deepEqual(gate.creates, [entryId]);
  assert.equal(gate.transfers.length, 1);
});

test("G. a test-mode worker does not send a live payment", async () => {
  const gate = memory();
  const result = await gate.settle({ workerLivemode: false });
  assert.equal(result.outcome, "held");
  assert.deepEqual(gate.creates, []);
  assert.match(gate.audits[0] ?? "", /mode/);
});

test("H. an unavailable or ambiguous lookup creates nothing", async () => {
  const unavailable = memory({ failLookup: true });
  assert.equal((await unavailable.settle()).outcome, "held");
  assert.deepEqual(unavailable.creates, []);

  const truncated = memory({ truncate: true });
  assert.equal((await truncated.settle()).outcome, "held");
  assert.deepEqual(truncated.creates, []);

  const ambiguous = memory({
    transfers: [
      { id: "tr_One", transfer_group: entryId, metadata: { ledger_id: entryId } },
      { id: "tr_Two", transfer_group: entryId, metadata: { ledger_id: entryId } },
    ],
  });
  assert.equal((await ambiguous.settle()).outcome, "held");
  assert.deepEqual(ambiguous.creates, []);
});

test("a second idempotency key is held for manual review", async () => {
  const gate = memory({ key: `${entryId}:funds:1` });
  const result = await gate.settle();
  assert.equal(result.outcome, "held");
  assert.deepEqual(gate.creates, []);
  await assert.rejects(
    createLedgerTransfer(gate.creator, {
      entryId,
      amountCents: 2975,
      destination,
      chargeId,
      idempotencyKey: `${entryId}:funds:1`,
    }),
    /new idempotency key/,
  );
});

test("reconciliation records a found transfer and does not create one", async () => {
  const found = memory({
    transfers: [{ id: "tr_FoundLater", transfer_group: entryId, metadata: { ledger_id: entryId } }],
  });
  const recorded = await found.settle({ allowCreate: false, ledgerTransferId: null });
  assert.equal(recorded.outcome, "recorded");
  assert.equal(found.stored, "tr_FoundLater");
  assert.deepEqual(found.creates, []);

  const missing = memory();
  const unresolved = await missing.settle({ allowCreate: false });
  assert.equal(unresolved.outcome, "held");
  assert.deepEqual(missing.creates, []);
});

test("a funding refusal does not mark an uncertain response as failed", () => {
  assert.equal(
    classifyTransferError({ type: "StripeConnectionError", message: "socket hang up" }),
    "temporary",
  );
  assert.equal(
    classifyTransferError({ type: "StripeInvalidRequestError", code: "balance_insufficient", message: "insufficient" }),
    "funding",
  );
  assert.equal(afterCreateResult({ kind: "temporary", transferId: null, message: "lost" }).action, "hold");
  const refused = recoverTransfer({
    entryId,
    ledgerTransferId: null,
    paymentLivemode: true,
    accountLivemode: true,
    workerLivemode: true,
    gate: "send",
    idempotencyKey: entryId,
    lookup: "absent",
    foundTransferId: null,
    allowCreate: true,
    failureKind: null,
  });
  assert.deepEqual(refused, { action: "create", idempotencyKey: entryId });
  const unknown = recoverTransfer({
    entryId,
    ledgerTransferId: null,
    paymentLivemode: true,
    accountLivemode: true,
    workerLivemode: true,
    gate: "send",
    idempotencyKey: entryId,
    lookup: "absent",
    foundTransferId: null,
    allowCreate: true,
    failureKind: "uncertain",
  });
  assert.equal(unknown.action, "hold");
});

test("a later lookup page is included before a transfer can be called found", async () => {
  const fillers = Array.from({ length: 100 }, (_, index) => ({
    id: `tr_Filler${index}`,
    transfer_group: "other-group",
    metadata: { ledger_id: "other" },
  }));
  const gate = memory({
    transfers: [...fillers, { id: "tr_OnPageTwo", transfer_group: entryId, metadata: { ledger_id: entryId } }],
  });
  const result = await gate.settle();
  assert.equal(result.outcome, "recorded");
  assert.equal(gate.stored, "tr_OnPageTwo");
  assert.deepEqual(gate.creates, []);
});

test("the transfer schedule is unchanged and no second key is restored", () => {
  const send = readFileSync(new URL("./transfers.ts", import.meta.url), "utf8");
  const reconcile = readFileSync(new URL("./transfer-reconcile.ts", import.meta.url), "utf8");
  const cron = readFileSync(new URL("../cron/jobs.ts", import.meta.url), "utf8");
  const vercel = readFileSync(new URL("../../vercel.json", import.meta.url), "utf8");
  assert.equal(send.includes("reopen_funding_transfer"), false);
  assert.equal(send.includes(":funds:"), false);
  assert.equal(readFileSync(new URL("./transfer-settle.ts", import.meta.url), "utf8").includes("begin(true)"), false);
  assert.equal(reconcile.includes("allowCreate: false"), true);
  assert.equal(cron.includes("transfer-reconcile"), false);
  assert.equal(vercel.includes("transfer-reconcile"), false);
  assert.equal(vercel.includes("/api/cron/transfers"), false);
});
