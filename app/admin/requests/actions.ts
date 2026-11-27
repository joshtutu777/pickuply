"use server";

import { connection } from "next/server";
import { redirect } from "next/navigation";
import { isMarketplaceRemovalCode, marketplaceRemovalMessage } from "@/lib/admin/marketplace-removal";
import { readRemovalStripeObjects } from "@/lib/admin/removal-stripe-read";
import { canFinishRemoval, logMarketplaceRemoval, removalLivemode, removalStripeIds, removalStripeVerdict } from "@/lib/admin/removal-stripe";
import { parseDollarsToCents } from "@/lib/money";
import { requestRefund } from "@/lib/payments/refunds";
import { recordFunnelServer } from "@/lib/funnel-server";
import { scheduleBookingTexts } from "@/lib/notifications/schedule-flush";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

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
  if (action === "publish") scheduleBookingTexts();
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

function requestPath(value: FormDataEntryValue | null): string {
  const path = String(value ?? "");
  if (!/^\/admin\/requests\/[0-9a-f-]{36}$/i.test(path)) return "/admin/requests";
  return path;
}

function removalError(path: string, code: string): never {
  redirect(`${path}?error=${encodeURIComponent(marketplaceRemovalMessage(isMarketplaceRemovalCode(code) ? code : ""))}`);
}

function finishRemoval(path: string, code: string): never {
  if (code === "removed" || code === "already_removed") {
    redirect(`${path}?removed=${code === "already_removed" ? "already" : "1"}`);
  }
  removalError(path, code);
}

export async function removeFromMarketplace(formData: FormData) {
  await connection();
  const path = requestPath(formData.get("returnTo"));
  const target = String(formData.get("jobId") ?? "");
  if (formData.get("confirm") !== "yes") {
    redirect(`${path}?error=${encodeURIComponent("Confirm the request before removing it from the marketplace.")}`);
  }
  if (!/^[0-9a-f-]{36}$/i.test(target)) {
    redirect(`${path}?error=${encodeURIComponent("Choose a request.")}`);
  }
  const supabase = await createClient();
  const { data: reason, error: reasonError } = await supabase.rpc("marketplace_removal_reason", { target });
  if (reasonError || typeof reason !== "string") removalError(path, "");
  if (reason !== "ready" && reason !== "needs_stripe") removalError(path, reason);

  const { data: userData, error: userError } = await supabase.auth.getUser();
  const actor = userData.user?.id ?? "";
  if (userError || !/^[0-9a-f-]{36}$/i.test(actor)) removalError(path, "");

  const [jobResult, paymentResult, attemptResult] = await Promise.all([
    supabase.from("jobs").select("payment_status, stripe_payment_intent_id").eq("id", target).maybeSingle(),
    supabase.from("job_payments").select("checkout_session_id, payment_intent_id, charge_id, stripe_livemode").eq("job_id", target),
    supabase.from("payment_attempts").select("checkout_session_id, payment_intent_id").eq("job_id", target),
  ]);
  if (jobResult.error || paymentResult.error || attemptResult.error || !jobResult.data) {
    if (reason === "ready") {
      const { data, error } = await supabase.rpc("admin_remove_from_marketplace", { target });
      if (error) removalError(path, "");
      finishRemoval(path, typeof data === "string" ? data : "");
    }
    removalError(path, "stripe_unverified");
  }
  const collected = removalStripeIds({
    jobIntent: jobResult.data.stripe_payment_intent_id,
    payments: paymentResult.data ?? [],
    attempts: attemptResult.data ?? [],
  });
  if (!collected.ok) removalError(path, "stripe_unverified");
  const observed = jobResult.data.payment_status ?? "";

  let verified = { sessions: [] as string[], intents: [] as string[], charges: [] as string[] };
  if (reason === "needs_stripe" || collected.ids.sessions.length + collected.ids.intents.length + collected.ids.charges.length > 0) {
    const read = await readRemovalStripeObjects(collected.ids, removalLivemode(paymentResult.data ?? []));
    const verdict = read.ok ? removalStripeVerdict(read.objects) : "unverified";
    if (!canFinishRemoval(collected.ids, verdict)) {
      removalError(path, verdict === "active" ? "stripe_active" : "stripe_unverified");
    }
    if (read.ok) verified = read.verified;
  }

  let verifiedCode: string | null = null;
  try {
    const service = createServiceClient();
    const { data, error } = await service.rpc("admin_remove_verified_marketplace", {
      target,
      actor,
      observed_payment_status: observed,
      verified_sessions: verified.sessions,
      verified_intents: verified.intents,
      verified_charges: verified.charges,
    });
    if (error) {
      logMarketplaceRemoval({ stage: "removal_rpc", code: error.code || "rpc_error", stripeError: null, key: null });
    } else {
      verifiedCode = typeof data === "string" ? data : "";
    }
  } catch {
    logMarketplaceRemoval({ stage: "removal_rpc", code: "service_unavailable", stripeError: null, key: null });
    verifiedCode = null;
  }
  if (verifiedCode !== null) finishRemoval(path, verifiedCode);
  if (reason !== "ready") removalError(path, "");

  const { data, error } = await supabase.rpc("admin_remove_from_marketplace", { target });
  if (error) removalError(path, "");
  finishRemoval(path, typeof data === "string" ? data : "");
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
  try {
    await requestRefund(jobId, amount, reason);
  } catch {
    redirect(`/admin/requests/${jobId}?error=${encodeURIComponent("The refund could not be completed.")}`);
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
