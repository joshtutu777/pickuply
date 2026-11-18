import { afterCreateResult, classifyTransferError, isTransferId, recoverTransfer } from "./transfer-recovery";
import { createLedgerTransfer, findLedgerTransfer, type TransferCreator, type TransferSearch } from "./transfer-stripe";

export type TransferGate = {
  action: "send" | "lookup" | "recorded" | "reconcile";
  transferId: string | null;
  idempotencyKey: string | null;
  failureKind: "funding" | "permanent" | "uncertain" | null;
};

export type TransferPorts = {
  begin: (confirmAbsent: boolean) => Promise<TransferGate | null>;
  record: (transferId: string) => Promise<boolean>;
  noteUnknown: () => Promise<void>;
  noteOutcome: (kind: "funding" | "permanent" | "uncertain") => Promise<void>;
  markFailed: (reason: string) => Promise<void>;
  audit: (reason: string) => Promise<void>;
};

export type SettleResult = {
  outcome: "recorded" | "created" | "held" | "refused";
  limit: string | null;
};

export async function settleOneTransfer(input: {
  entryId: string;
  amountCents: number;
  destination: string;
  chargeId: string;
  paymentLivemode: boolean;
  accountLivemode: boolean;
  workerLivemode: boolean;
  ledgerTransferId: string | null;
  allowCreate: boolean;
  search: TransferSearch;
  creator: TransferCreator;
  ports: TransferPorts;
}): Promise<SettleResult> {
  const held = (): SettleResult => ({ outcome: "held", limit: null });
  if (
    input.paymentLivemode !== input.workerLivemode ||
    input.accountLivemode !== input.workerLivemode
  ) {
    await input.ports.audit("The payment mode does not match this transfer worker.");
    return held();
  }
  if (isTransferId(input.ledgerTransferId)) {
    const recorded = await input.ports.record(input.ledgerTransferId);
    if (!recorded) await input.ports.audit("The existing transfer could not be recorded.");
    return { outcome: recorded ? "recorded" : "held", limit: null };
  }

  if (!input.allowCreate) {
    const located = await findLedgerTransfer(input.search, input.entryId, input.destination || null);
    const decision = recoverTransfer({
      entryId: input.entryId,
      ledgerTransferId: null,
      paymentLivemode: input.paymentLivemode,
      accountLivemode: input.accountLivemode,
      workerLivemode: input.workerLivemode,
      gate: "lookup",
      idempotencyKey: input.entryId,
      lookup: located.state,
      foundTransferId: located.transferId,
      allowCreate: false,
      failureKind: "uncertain",
    });
    if (decision.action === "record") {
      const recorded = await input.ports.record(decision.transferId);
      if (!recorded) await input.ports.audit("A found transfer could not be recorded.");
      return { outcome: recorded ? "recorded" : "held", limit: null };
    }
    await input.ports.audit(decision.action === "hold" ? decision.reason : "The transfer stayed unresolved.");
    return held();
  }

  const located = await findLedgerTransfer(input.search, input.entryId, input.destination || null);
  if (located.state === "found" && isTransferId(located.transferId)) {
    const recorded = await input.ports.record(located.transferId);
    if (!recorded) await input.ports.audit("A found transfer could not be recorded.");
    return { outcome: recorded ? "recorded" : "held", limit: null };
  }
  if (located.state !== "absent") {
    await input.ports.audit(
      located.state === "ambiguous"
        ? "More than one Stripe transfer matches this ledger row."
        : "Stripe lookup is incomplete. No transfer will be created.",
    );
    return held();
  }

  const opened = await input.ports.begin(false);
  if (opened?.action === "recorded" && isTransferId(opened.transferId)) {
    const recorded = await input.ports.record(opened.transferId);
    return { outcome: recorded ? "recorded" : "held", limit: null };
  }
  const decision = recoverTransfer({
    entryId: input.entryId,
    ledgerTransferId: null,
    paymentLivemode: input.paymentLivemode,
    accountLivemode: input.accountLivemode,
    workerLivemode: input.workerLivemode,
    gate: opened?.action ?? null,
    idempotencyKey: opened?.idempotencyKey ?? null,
    lookup: "absent",
    foundTransferId: null,
    allowCreate: true,
    failureKind: opened?.failureKind ?? null,
  });
  if (decision.action === "hold") {
    if (!opened?.failureKind) {
      await input.ports.noteOutcome("uncertain");
      await input.ports.noteUnknown();
    }
    await input.ports.audit(decision.reason);
    return held();
  }
  if (decision.action !== "create") return held();

  try {
    const transferId = await createLedgerTransfer(input.creator, {
      entryId: input.entryId,
      amountCents: input.amountCents,
      destination: input.destination,
      chargeId: input.chargeId,
      idempotencyKey: decision.idempotencyKey,
    });
    const recorded = await input.ports.record(transferId);
    if (!recorded) {
      await input.ports.noteUnknown();
      await input.ports.audit("Stripe created the transfer, but the ledger could not store it yet.");
      return held();
    }
    return { outcome: "created", limit: null };
  } catch (error) {
    const kind = classifyTransferError(error);
    const message = error instanceof Error ? error.message : "The transfer could not be sent.";
    const follow = afterCreateResult({ kind, transferId: null, message });
    if (follow.action === "refused" && follow.kind === "capability") {
      await input.ports.noteOutcome("permanent");
      await input.ports.noteUnknown();
      await input.ports.audit(follow.reason);
      return { outcome: "refused", limit: null };
    }
    if (follow.action === "refused") {
      await input.ports.noteOutcome(follow.kind === "funding" ? "funding" : "permanent");
      await input.ports.markFailed(follow.reason);
      await input.ports.noteUnknown();
      await input.ports.audit(follow.reason);
      return { outcome: "refused", limit: follow.kind === "funding" ? follow.reason : null };
    }
    await input.ports.noteOutcome("uncertain");
    await input.ports.noteUnknown();
    await input.ports.audit(follow.action === "hold" ? follow.reason : "The Stripe response was lost.");
    return held();
  }
}
