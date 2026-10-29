"use server";

import { connection } from "next/server";
import { redirect } from "next/navigation";
import { parseDollarsToCents } from "@/lib/money";
import { requestRefund } from "@/lib/payments/refunds";
import { alertPaymentsIssue } from "@/lib/payments/mode-alert";
import { alignPaymentsMode } from "@/lib/payments/mode-sync";
import { readStripeLivemode, stripeObjectMatchesMode } from "@/lib/payments/object-mode";
import { getStripe } from "@/lib/stripe";
import { createServiceClient } from "@/lib/supabase/service";
import { recordFunnelServer } from "@/lib/funnel-server";
import { createClient } from "@/lib/supabase/server";

const detailItems = ["stairs", "size", "pieces", "item_value", "access_notes", "photos"] as const;

export async function askForDetails(formData: FormData) {
  await connection();
  const jobId = String(formData.get("jobId") ?? "");
  const note = String(formData.get("note") ?? "");
  const items = formData
    .getAll("item")
    .map(String)
    .filter((item): item is (typeof detailItems)[number] =>
      detailItems.includes(item as (typeof detailItems)[number]),
    );
  const supabase = await createClient();
  const { error } = await supabase.rpc("ask_for_details", {
    target_job: jobId,
    items,
    note,
    should_pause: formData.get("pauseUntilUpdated") === "on",
  });
  if (error) {
    redirect(`/admin/requests/${jobId}?error=${encodeURIComponent(error.message)}`);
  }
  redirect(`/admin/requests/${jobId}?saved=1`);
}

export async function pauseRequest(formData: FormData) {
  await connection();
  const jobId = String(formData.get("jobId") ?? "");
  const shouldPause = String(formData.get("paused") ?? "") !== "no";
  const supabase = await createClient();
  const { error } = await supabase.rpc("pause_request", {
    target_job: jobId,
    should_pause: shouldPause,
  });
  if (error) {
    redirect(`/admin/requests/${jobId}?error=${encodeURIComponent(error.message)}`);
  }
  redirect(`/admin/requests/${jobId}?saved=1`);
}

export async function reviewRequest(formData: FormData) {
  await connection();
  const jobId = String(formData.get("jobId") ?? "");
  const action = String(formData.get("action") ?? "");
  const driverPay = parseDollarsToCents(String(formData.get("driverPay") ?? ""));
  const dumpFee = parseDollarsToCents(String(formData.get("dumpFee") || "0")) ?? 0;
  const details = {
    zone_id: String(formData.get("zoneId") ?? ""),
    service_level: String(formData.get("serviceLevel") ?? ""),
    required_vehicle: String(formData.get("requiredVehicle") ?? ""),
    dump_fee_cents: dumpFee,
    high_value_ok: formData.get("highValueOk") === "on",
    driver_pay_cents: driverPay,
    preferred_date: String(formData.get("preferredDate") ?? ""),
    time_window: String(formData.get("timeWindow") ?? ""),
    expires_hours: Number(formData.get("expiresHours") || 24),
    note: String(formData.get("note") ?? ""),
  };
  const supabase = await createClient();
  const { error } = await supabase.rpc("review_request", {
    target_job: jobId,
    action,
    details,
  });
  if (error) {
    redirect(`/admin/requests/${jobId}?error=${encodeURIComponent(error.message)}`);
  }
  if (action === "quote") {
    await recordFunnelServer({ event: "quote_sent", step: "sent", pricing: "quote" });
  }
  redirect(`/admin/requests/${jobId}?saved=1`);
}

export async function assignCoveringDriver(formData: FormData) {
  await connection();
  const jobId = String(formData.get("jobId") ?? "");
  const driverId = String(formData.get("driverId") ?? "");
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_assign_driver", {
    target_job: jobId,
    target_driver: driverId,
  });
  if (error) redirect(`/admin/requests/${jobId}?error=${encodeURIComponent(error.message)}`);
  redirect(`/admin/requests/${jobId}?saved=1`);
}

export async function inviteDriver(formData: FormData) {
  await connection();
  const jobId = String(formData.get("jobId") ?? "");
  const driverId = String(formData.get("driverId") ?? "");
  const supabase = await createClient();
  const { error } = await supabase.rpc("invite_driver", {
    target_job: jobId,
    target_driver: driverId,
  });
  if (error) redirect(`/admin/requests/${jobId}?error=${encodeURIComponent(error.message)}`);
  redirect(`/admin/requests/${jobId}?saved=1`);
}

export async function overrideJobStatus(formData: FormData) {
  await connection();
  const jobId = String(formData.get("jobId") ?? "");
  const nextStatus = String(formData.get("nextStatus") ?? "");
  const reason = String(formData.get("reason") ?? "");
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_override_status", {
    target_job: jobId,
    next_status: nextStatus,
    reason,
  });
  if (error) redirect(`/admin/requests/${jobId}?error=${encodeURIComponent("The status could not be changed.")}`);
  redirect(`/admin/requests/${jobId}?saved=1`);
}

export async function refundJob(formData: FormData) {
  await connection();
  const jobId = String(formData.get("jobId") ?? "");
  const amount = Math.round(Number(formData.get("amount") || 0) * 100);
  const reason = String(formData.get("reason") ?? "");
  const includeServiceFee = formData.get("includeServiceFee") === "yes";
  try {
    await requestRefund(jobId, amount, reason, includeServiceFee);
  } catch {
    redirect(`/admin/requests/${jobId}?error=${encodeURIComponent("The refund could not be completed.")}`);
  }
  redirect(`/admin/requests/${jobId}?saved=1`);
}

export async function refundTip(formData: FormData) {
  await connection();
  const jobId = String(formData.get("jobId") ?? "");
  const amount = Math.round(Number(formData.get("amount") || 0) * 100);
  const reason = String(formData.get("reason") ?? "");
  const supabase = await createClient();
  const aligned = await alignPaymentsMode();
  if (!aligned.matches) {
    redirect(`/admin/requests/${jobId}?error=${encodeURIComponent("Payments are paused. Try again in a few minutes.")}`);
  }
  const tip = await supabase.from("job_tips").select("id, stripe_charge_id").eq("job_id", jobId).not("paid_at", "is", null).maybeSingle();
  if (!tip.data?.id) redirect(`/admin/requests/${jobId}?error=${encodeURIComponent("This job has no tip to refund.")}`);
  if (tip.data.stripe_charge_id) {
    const charge = await getStripe().charges.retrieve(tip.data.stripe_charge_id);
    if (!stripeObjectMatchesMode(aligned.mode, charge.livemode)) {
      await alertPaymentsIssue(
        `tip-refund-mode:${charge.id}`,
        "Tip refund mode mismatch",
        "A tip refund did not match the payment switch. The card was left unchanged.",
      );
      redirect(`/admin/requests/${jobId}?error=${encodeURIComponent("This tip does not match the current payment mode.")}`);
    }
  }
  const started = await supabase.rpc("begin_tip_refund", {
    target_tip: tip.data.id,
    amount_cents: amount,
    reason,
  });
  if (started.error || !started.data) {
    redirect(`/admin/requests/${jobId}?error=${encodeURIComponent("The tip refund could not be started.")}`);
  }
  const row = started.data as { refund_id: string; charge_id: string; amount_cents: number };
  try {
    const refund = await getStripe().refunds.create(
      {
        charge: row.charge_id,
        amount: row.amount_cents,
        metadata: { tip_refund_id: row.refund_id },
      },
      { idempotencyKey: `tip-refund:${row.refund_id}` },
    );
    const refundLive = readStripeLivemode(refund);
    if (refundLive === null || !stripeObjectMatchesMode(aligned.mode, refundLive)) {
      await alertPaymentsIssue(
        `tip-refund-result:${refund.id}`,
        "Tip refund mode mismatch",
        "Stripe returned a tip refund in a different mode. It is recorded so the ledger matches Stripe.",
      );
    }
    if (refund.status === "succeeded") {
      const applied = await createServiceClient().rpc("apply_tip_refund", {
        target_refund: row.refund_id,
        stripe_refund_id: refund.id,
        succeeded: true,
      });
      if (applied.error) throw new Error(applied.error.message);
    }
  } catch {
    redirect(`/admin/requests/${jobId}?error=${encodeURIComponent("The tip refund could not be completed.")}`);
  }
  redirect(`/admin/requests/${jobId}?saved=1`);
}

export async function saveSettings(formData: FormData) {
  await connection();
  const supabase = await createClient();
  const { error } = await supabase.rpc("update_platform_settings", {
    platform_bps: Number(formData.get("platformBps")),
    platform_min_cents: Math.round(Number(formData.get("platformMin")) * 100),
    service_bps: Number(formData.get("serviceBps")),
    service_fixed_cents: Math.round(Number(formData.get("serviceFixed")) * 100),
    payment_due_minutes: Number(formData.get("paymentDueMinutes")),
  });
  if (error) {
    redirect(`/admin/settings?error=${encodeURIComponent(error.message)}`);
  }
  redirect("/admin/settings?saved=1");
}
