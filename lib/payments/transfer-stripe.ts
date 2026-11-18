import { isLedgerEntryId, isTransferId, type TransferLookupState } from "./transfer-recovery";

export type ListedTransfer = {
  id: string;
  transfer_group?: string | null;
  metadata?: { ledger_id?: string | null } | null;
};

export type TransferSearch = {
  list(params: {
    transfer_group?: string;
    destination?: string;
    limit: number;
    starting_after?: string;
  }): Promise<{
    data: ListedTransfer[];
    has_more?: boolean;
  }>;
};

export type TransferCreateParams = {
  amount: number;
  currency: "usd";
  destination: string;
  source_transaction: string;
  transfer_group: string;
  metadata: { ledger_id: string };
};

export type TransferCreator = {
  create(params: TransferCreateParams, options: { idempotencyKey: string }): Promise<{ id: string }>;
};

export async function findLedgerTransfer(
  search: TransferSearch,
  entryId: string,
  destination: string | null,
): Promise<{ state: TransferLookupState; transferId: string | null }> {
  if (!isLedgerEntryId(entryId)) return { state: "unavailable", transferId: null };
  const grouped = await listEntire(search, { transfer_group: entryId });
  if (!grouped) return { state: "unavailable", transferId: null };
  const groupedMatch = concludedMatch(grouped, entryId);
  if (groupedMatch !== "continue") return groupedMatch;

  if (!destination) return { state: "unavailable", transferId: null };
  const listed = await listEntire(search, { destination });
  if (!listed) return { state: "unavailable", transferId: null };
  const matched = concludedMatch(listed, entryId);
  if (matched !== "continue") return matched;
  return { state: "absent", transferId: null };
}

export async function createLedgerTransfer(
  creator: TransferCreator,
  input: {
    entryId: string;
    amountCents: number;
    destination: string;
    chargeId: string;
    idempotencyKey: string;
  },
): Promise<string> {
  if (input.idempotencyKey !== input.entryId || !isLedgerEntryId(input.entryId)) {
    throw new Error("Refusing to create a transfer with a new idempotency key.");
  }
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0 || !input.destination || !input.chargeId) {
    throw new Error("The transfer details are incomplete.");
  }
  const transfer = await creator.create(
    {
      amount: input.amountCents,
      currency: "usd",
      destination: input.destination,
      source_transaction: input.chargeId,
      transfer_group: input.entryId,
      metadata: { ledger_id: input.entryId },
    },
    { idempotencyKey: input.entryId },
  );
  if (!isTransferId(transfer.id)) throw new Error("Stripe did not return a transfer id.");
  return transfer.id;
}

function uniqueMatch(rows: ListedTransfer[], entryId: string): string | "ambiguous" | null {
  const ids = new Set<string>();
  for (const row of rows) {
    const matches = row.transfer_group === entryId || row.metadata?.ledger_id === entryId;
    if (!matches) continue;
    if (!isTransferId(row.id)) return "ambiguous";
    ids.add(row.id);
  }
  if (ids.size > 1) return "ambiguous";
  return ids.size === 1 ? [...ids][0] : null;
}

function concludedMatch(
  page: { data: ListedTransfer[]; complete: boolean },
  entryId: string,
): { state: TransferLookupState; transferId: string | null } | "continue" {
  const matched = uniqueMatch(page.data, entryId);
  if (matched === "ambiguous") return { state: "ambiguous", transferId: null };
  if (matched && page.complete) return { state: "found", transferId: matched };
  if (matched || !page.complete) return { state: "unavailable", transferId: null };
  return "continue";
}

async function listEntire(
  search: TransferSearch,
  params: { transfer_group?: string; destination?: string },
): Promise<{ data: ListedTransfer[]; complete: boolean } | null> {
  const data: ListedTransfer[] = [];
  let startingAfter: string | undefined;
  try {
    for (let page = 0; page < 20; page += 1) {
      const listed = await search.list({ ...params, limit: 100, starting_after: startingAfter });
      data.push(...listed.data);
      if (!listed.has_more) return { data, complete: true };
      const last = listed.data[listed.data.length - 1];
      if (!last?.id || last.id === startingAfter) return { data, complete: false };
      startingAfter = last.id;
    }
  } catch {
    return null;
  }
  return { data, complete: false };
}
