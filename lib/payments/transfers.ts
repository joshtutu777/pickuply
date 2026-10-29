import "server-only";

import { readTransfersStatus, requestDriverTransfers } from "@/lib/payments/connect-capability";
import { missingTransfersCapability, transfersCapabilityActive } from "@/lib/payments/transfer-readiness";
import { getStripe } from "@/lib/stripe";
import { transferSentNotice } from "@/lib/payments/earnings";
import { createLedgerTransfer, findTransferByLedger } from "@/lib/payments/transfer-stripe";
import {
  afterLookupFailure,
  isLedgerEntryId,
  nextTransferStep,
  transferIdempotencyKey,
  type TransferGateAction,
  type TransferSearch,
} from "@/lib/payments/transfer-match";
import { createServiceClient } from "@/lib/supabase/service";

type ReadyTransfer = {
  entry_id: string;
  amount_cents: number;
  driver_id: string;
  stripe_account_id: string;
  charge_id: string;
  job_id: string;
};

type TransferGate = {
  action: TransferGateAction;
  transfer_id: string | null;
  idempotency_key: string;
};

function responseLost(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const type = "type" in error ? String(error.type) : "";
  const status = "statusCode" in error ? Number(error.statusCode) : 0;
  return type === "StripeConnectionError" || status >= 500;
}

async function locateTransfer(entryId: string): Promise<{ id: string | null; located: TransferSearch; error: string | null }> {
  try {
    const id = await findTransferByLedger(getStripe(), entryId);
    return { id, located: id ? "found" : "absent", error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : "The transfer lookup failed.";
    return { id: null, located: "unknown", error: message.slice(0, 300) };
  }
}

async function beginTransfer(entryId: string, confirmAbsent: boolean): Promise<TransferGate | null> {
  const result = await createServiceClient().rpc("begin_transfer_send", {
    target_entry: entryId,
    confirm_absent: confirmAbsent,
  });
  if (result.error || !result.data) return null;
  return result.data as TransferGate;
}

async function refreshHeldTransferCapabilities(): Promise<void> {
  const supabase = createServiceClient();
  const held = await supabase
    .from("ledger_entries")
    .select("driver_id")
    .eq("status", "held_until_onboarding")
    .is("stripe_transfer_id", null)
    .limit(20);
  const driverIds = [...new Set((held.data ?? []).map((row) => row.driver_id).filter(Boolean))];
  if (driverIds.length === 0) return;
  const accounts = await supabase
    .from("driver_connect_accounts")
    .select("driver_id, stripe_account_id")
    .in("driver_id", driverIds);
  for (const account of accounts.data ?? []) {
    try {
      let status = await readTransfersStatus(account.stripe_account_id);
      if (!transfersCapabilityActive(status)) {
        try {
          await requestDriverTransfers(account.stripe_account_id);
        } catch {
          // Stripe may already have the request. The status read below is what we store.
        }
        status = await readTransfersStatus(account.stripe_account_id);
      }
      await supabase
        .from("driver_connect_accounts")
        .update({ transfers_active: transfersCapabilityActive(status), synced_at: new Date().toISOString() })
        .eq("driver_id", account.driver_id);
    } catch {
      // The next transfer run reads Stripe again.
    }
  }
}

async function recordLookupFailure(entryId: string, reason: string): Promise<number> {
  const result = await createServiceClient().rpc("note_transfer_lookup_failure", {
    target_entry: entryId,
    reason: reason.slice(0, 300),
  });
  const count = Number(result.data);
  if (result.error || !Number.isInteger(count)) return 1;
  return count;
}

async function alertLookupFailure(entryId: string, reason: string): Promise<void> {
  const supabase = createServiceClient();
  const now = new Date().toISOString();
  await supabase.from("audit_log").insert({
    actor_id: null,
    action: "transfer_lookup_failed",
    target_type: "ledger_entry",
    target_id: entryId,
    data: { note: reason.slice(0, 300) },
  });
  const admins = await supabase.from("profiles").select("id").eq("role", "admin");
  for (const admin of admins.data ?? []) {
    await supabase.from("notifications").insert({
      profile_id: admin.id,
      job_id: null,
      kind: "transfer_lookup",
      title: "Transfer lookup failed",
      body: "A transfer lookup failed. It will be tried again. After three failures the same ledger transfer is sent.",
      href: "/admin/finance",
      dedupe_key: `transfer-lookup:${entryId}`,
      push_sent_at: now,
      email_sent_at: now,
      sms_sent_at: now,
    });
  }
}

async function notifyDriverSent(row: ReadyTransfer): Promise<void> {
  await createServiceClient().rpc("enqueue_notification", {
    recipient: row.driver_id,
    target_job: row.job_id,
    kind: "transfer_sent",
    title: "Earnings sent",
    body: transferSentNotice(row.amount_cents, row.job_id),
    href: "/driver/earnings",
    dedupe_key: `transfer-sent:${row.entry_id}`,
  });
}

async function alertNeedsPayoutSetup(entryId: string): Promise<void> {
  const supabase = createServiceClient();
  const now = new Date().toISOString();
  await supabase.from("audit_log").insert({
    actor_id: null,
    action: "transfer_needs_setup",
    target_type: "ledger_entry",
    target_id: entryId,
    data: { note: "Needs payout setup" },
  });
  const admins = await supabase.from("profiles").select("id").eq("role", "admin");
  for (const admin of admins.data ?? []) {
    await supabase.from("notifications").insert({
      profile_id: admin.id,
      job_id: null,
      kind: "transfer_setup",
      title: "Transfer needs payout setup",
      body: "A driver transfer is waiting because Stripe transfers are not active. It will be sent again once that capability is active.",
      href: "/admin/finance",
      dedupe_key: `transfer-setup:${entryId}`,
      push_sent_at: now,
      email_sent_at: now,
      sms_sent_at: now,
    });
  }
}

export async function sendReadyTransfers(only?: { jobId?: string; driverId?: string }): Promise<string | null> {
  const supabase = createServiceClient();
  await refreshHeldTransferCapabilities();
  const refreshed = await supabase.rpc("refresh_ledger_readiness");
  if (refreshed.error) return "The payout list could not be refreshed.";
  const ready = await supabase.rpc("ready_transfers");
  if (ready.error) return "Transfers could not be listed.";

  let limit: string | null = null;
  for (const row of (ready.data ?? []) as ReadyTransfer[]) {
    if (only?.jobId && row.job_id !== only.jobId) continue;
    if (only?.driverId && row.driver_id !== only.driverId) continue;
    if (!isLedgerEntryId(row.entry_id) || transferIdempotencyKey(row.entry_id) !== row.entry_id) continue;
    let gate = await beginTransfer(row.entry_id, false);
    if (!gate || gate.idempotency_key !== row.entry_id) continue;
    let located = await locateTransfer(row.entry_id);
    if (located.located === "unknown") {
      const failures = await recordLookupFailure(row.entry_id, located.error ?? "The transfer lookup failed.");
      try {
        await alertLookupFailure(row.entry_id, located.error ?? "The transfer lookup failed.");
      } catch {
        // The count is already stored. The next transfer job reads it again.
      }
      if (afterLookupFailure(failures) === "retry") {
        await supabase.rpc("note_transfer_unknown", { target_entry: row.entry_id });
        continue;
      }
      located = { id: null, located: "absent", error: null };
      if (gate.action !== "send") {
        gate = await beginTransfer(row.entry_id, true);
        if (!gate || gate.idempotency_key !== row.entry_id || gate.action !== "send") continue;
      }
    }
    let step = nextTransferStep(gate.action, located.located);
    if (step === "confirm") {
      gate = await beginTransfer(row.entry_id, true);
      if (!gate || gate.idempotency_key !== row.entry_id) continue;
      step = nextTransferStep(gate.action, "absent");
    }
    const knownId = located.id ?? gate.transfer_id;
    if (step === "record" && knownId) {
      const marked = await supabase.rpc("record_claimed_transfer", {
        target_entry: row.entry_id,
        transfer_id: knownId,
      });
      if (marked.error) await supabase.rpc("note_transfer_unknown", { target_entry: row.entry_id });
      else {
        try {
          await notifyDriverSent(row);
        } catch {
          // The transfer is already recorded. The driver can still see it on Earnings.
        }
      }
      continue;
    }
    if (step !== "create") {
      if (step === "reconcile" || located.located === "unknown") {
        await supabase.rpc("note_transfer_unknown", { target_entry: row.entry_id });
      }
      continue;
    }

    try {
      const transferId = await createLedgerTransfer(getStripe(), {
        entryId: row.entry_id,
        amountCents: row.amount_cents,
        destination: row.stripe_account_id,
        chargeId: row.charge_id,
      });
      const marked = await supabase.rpc("record_claimed_transfer", {
        target_entry: row.entry_id,
        transfer_id: transferId,
      });
      if (marked.error) throw new Error("The transfer could not be recorded.");
      try {
        await notifyDriverSent(row);
      } catch {
        // The transfer is already recorded. The driver can still see it on Earnings.
      }
    } catch (error) {
      if (missingTransfersCapability(error)) {
        await supabase.from("driver_connect_accounts").update({ transfers_active: false }).eq("driver_id", row.driver_id);
        await supabase.rpc("note_transfer_needs_setup", { target_entry: row.entry_id });
        try {
          await alertNeedsPayoutSetup(row.entry_id);
        } catch {
          // The ledger is already marked. The next account update retries the same claim.
        }
        continue;
      }
      await supabase.rpc("note_transfer_unknown", { target_entry: row.entry_id });
      if (responseLost(error)) continue;
      const message = error instanceof Error ? error.message : "The transfer could not be sent.";
      if (/source_transaction|insufficient|balance/i.test(message)) limit = message.slice(0, 180);
      await supabase.rpc("mark_transfer_failed", {
        target_entry: row.entry_id,
        reason: message.slice(0, 300),
      });
    }
  }
  return limit;
}
