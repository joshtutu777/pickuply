import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { TransferGate, TransferPorts } from "./transfer-settle";

type GateAction = TransferGate["action"];

export function transferPorts(supabase: SupabaseClient, entryId: string): TransferPorts {
  return {
    async begin(confirmAbsent) {
      const result = await supabase.rpc("begin_transfer_send", {
        target_entry: entryId,
        confirm_absent: confirmAbsent,
      });
      if (result.error) return null;
      return readGate(result.data);
    },
    async record(transferId) {
      const result = await supabase.rpc("record_claimed_transfer", {
        target_entry: entryId,
        transfer_id: transferId,
      });
      return !result.error;
    },
    async noteUnknown() {
      await supabase.rpc("note_transfer_unknown", { target_entry: entryId });
    },
    async noteOutcome(kind) {
      await supabase.rpc("note_transfer_outcome", { target_entry: entryId, kind });
    },
    async markFailed(reason) {
      await supabase.rpc("mark_transfer_failed", {
        target_entry: entryId,
        reason: reason.slice(0, 300),
      });
    },
    async audit(reason) {
      await supabase.from("audit_log").insert({
        actor_id: null,
        action: "transfer_unresolved",
        target_type: "ledger_entry",
        target_id: entryId,
        data: { reason: reason.slice(0, 300) },
      });
    },
  };
}

function readGate(value: unknown): TransferGate | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (!isGateAction(row.action)) return null;
  return {
    action: row.action,
    transferId: typeof row.transfer_id === "string" ? row.transfer_id : null,
    idempotencyKey: typeof row.idempotency_key === "string" ? row.idempotency_key : null,
    failureKind: failureKind(row.failure_kind),
  };
}

function failureKind(value: unknown): "funding" | "permanent" | "uncertain" | null {
  if (value === "funding" || value === "permanent" || value === "uncertain") return value;
  return null;
}

function isGateAction(value: unknown): value is GateAction {
  return value === "send" || value === "lookup" || value === "recorded" || value === "reconcile";
}
