import "server-only";

import { readTransfersStatus, requestDriverTransfers } from "@/lib/payments/connect-capability";
import { missingTransfersCapability, transfersCapabilityActive } from "@/lib/payments/transfer-readiness";
import { getStripe } from "@/lib/stripe";
import { transferSentNotice } from "@/lib/payments/earnings";
import { createLedgerTransfer, findTransferByLedger } from "@/lib/payments/transfer-stripe";
import {
  isLedgerEntryId,
  lookupErrorKind,
  lookupFailureAction,
  nextTransferStep,
  transferIdempotencyKey,
  type TransferGateAction,
  type TransferSearch,
} from "@/lib/payments/transfer-match";
import { paymentsMode } from "@/lib/payments/payments-mode";
import { syncPaymentsMode } from "@/lib/payments/mode-sync";
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

async function locateTransfer(
  entryId: string,
  destination: string,
  createdAfter: Date | null,
): Promise<{ id: string | null; located: TransferSearch; error: string | null; kind: "transient" | "configuration" }> {
  try {
    const id = await findTransferByLedger(
      getStripe(),
      entryId,
      createdAfter ? { destination, createdAfter } : undefined,
    );
    return { id, located: id ? "found" : "absent", error: null, kind: "transient" };
  } catch (error) {
    const message = error instanceof Error ? error.message : "The transfer lookup failed.";
    const details = error && typeof error === "object" ? error : {};
    return {
      id: null,
      located: "unknown",
      error: message.slice(0, 300),
      kind: lookupErrorKind({
        type: "type" in details ? String(details.type) : "",
        statusCode: "statusCode" in details ? Number(details.statusCode) : 0,
        code: "code" in details ? String(details.code) : "",
        message,
      }),
    };
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

async function recordLookupFailure(entryId: string, reason: string): Promise<{ attempts: number; firstAttemptAt: Date | null }> {
  const result = await createServiceClient().rpc("note_transfer_lookup_failure", {
    target_entry: entryId,
    reason: reason.slice(0, 300),
  });
  const data = result.data as { failures?: number; first_attempt_at?: string | null } | null;
  const attempts = Number(data?.failures);
  if (result.error || !Number.isInteger(attempts)) return { attempts: 1, firstAttemptAt: new Date() };
  return {
    attempts,
    firstAttemptAt: data?.first_attempt_at ? new Date(data.first_attempt_at) : null,
  };
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
      body: "A transfer lookup failed. It will be tried again on the next transfer job.",
      href: "/admin/finance",
      dedupe_key: `transfer-lookup:${entryId}`,
      push_sent_at: now,
      email_sent_at: now,
      sms_sent_at: now,
    });
  }
}

async function alertLookupConfiguration(entryId: string, reason: string): Promise<void> {
  const supabase = createServiceClient();
  const now = new Date().toISOString();
  await supabase.from("audit_log").insert({
    actor_id: null,
    action: "transfer_lookup_config",
    target_type: "ledger_entry",
    target_id: entryId,
    data: { note: reason.slice(0, 300) },
  });
  const admins = await supabase.from("profiles").select("id").eq("role", "admin");
  for (const admin of admins.data ?? []) {
    await supabase.from("notifications").insert({
      profile_id: admin.id,
      job_id: null,
      kind: "transfer_lookup_config",
      title: "Transfer lookup needs attention",
      body: "A transfer lookup failed because of a Stripe key, permission, or account problem. It was not counted as a retry.",
      href: "/admin/finance",
      dedupe_key: `transfer-lookup-config:${entryId}`,
      push_sent_at: now,
      email_sent_at: now,
      sms_sent_at: now,
    });
  }
}

async function alertNeedsReconciliation(entryId: string): Promise<void> {
  const supabase = createServiceClient();
  const now = new Date().toISOString();
  await supabase.from("audit_log").insert({
    actor_id: null,
    action: "transfer_needs_reconciliation",
    target_type: "ledger_entry",
    target_id: entryId,
    data: { note: "Needs reconciliation" },
  });
  const admins = await supabase.from("profiles").select("id").eq("role", "admin");
  for (const admin of admins.data ?? []) {
    await supabase.from("notifications").insert({
      profile_id: admin.id,
      job_id: null,
      kind: "transfer_reconcile",
      title: "Transfer needs reconciliation",
      body: "A transfer was not sent again because the first attempt is at least 23 hours old. It needs reconciliation.",
      href: "/admin/finance/reconciliation",
      dedupe_key: `transfer-reconcile:${entryId}`,
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
  const mode = paymentsMode(process.env.PAYMENTS_MODE);
  const synced = await syncPaymentsMode();
  if (mode === "live" && !synced.saved) return "Payments mode could not be saved.";
  await refreshHeldTransferCapabilities();
  const refreshed = await supabase.rpc("refresh_ledger_readiness");
  if (refreshed.error) return "The payout list could not be refreshed.";
  const ready =
    mode === "live"
      ? await supabase.rpc("ready_transfers", { target_livemode: true })
      : await supabase.rpc("ready_transfers");
  if (ready.error) return "Transfers could not be listed.";

  let limit: string | null = null;
  for (const row of (ready.data ?? []) as ReadyTransfer[]) {
    if (only?.jobId && row.job_id !== only.jobId) continue;
    if (only?.driverId && row.driver_id !== only.driverId) continue;
    if (!isLedgerEntryId(row.entry_id) || transferIdempotencyKey(row.entry_id) !== row.entry_id) continue;
    let gate = await beginTransfer(row.entry_id, false);
    if (!gate || gate.idempotency_key !== row.entry_id) continue;
    const job = await supabase.from("jobs").select("completed_at").eq("id", row.job_id).maybeSingle();
    const completedAt = job.data?.completed_at ? new Date(job.data.completed_at) : null;
    const createdAfter = completedAt ? new Date(completedAt.getTime() - 2 * 60 * 1000) : null;
    let located = await locateTransfer(row.entry_id, row.stripe_account_id, createdAfter);
    if (located.located === "unknown") {
      const reason = located.error ?? "The transfer lookup failed.";
      if (located.kind === "configuration") {
        try {
          await alertLookupConfiguration(row.entry_id, reason);
        } catch {
          // The next transfer job tries the lookup again. This failure is not counted.
        }
        await supabase.rpc("note_transfer_unknown", { target_entry: row.entry_id });
        continue;
      }
      const failure = await recordLookupFailure(row.entry_id, reason);
      const action = lookupFailureAction({
        attempts: failure.attempts,
        kind: "transient",
      });
      if (action === "retry") {
        try {
          await alertLookupFailure(row.entry_id, reason);
        } catch {
          // The count is already stored. The next transfer job reads it again.
        }
        await supabase.rpc("note_transfer_unknown", { target_entry: row.entry_id });
        continue;
      }
      try {
        await alertNeedsReconciliation(row.entry_id);
      } catch {
        // The claim stays unresolved. A failed lookup does not create a transfer.
      }
      await supabase.rpc("note_transfer_unknown", { target_entry: row.entry_id });
      continue;
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
      if (step === "reconcile") {
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
