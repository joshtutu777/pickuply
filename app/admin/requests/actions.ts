"use server";

import { connection } from "next/server";
import { redirect } from "next/navigation";
import { isMarketplaceRemovalCode, marketplaceRemovalMessage } from "@/lib/admin/marketplace-removal";
import { parseDollarsToCents } from "@/lib/money";
import { requestRefund } from "@/lib/payments/refunds";
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

function requestPath(value: FormDataEntryValue | null): string {
  const path = String(value ?? "");
  if (!/^\/admin\/requests\/[0-9a-f-]{36}$/i.test(path)) return "/admin/requests";
  return path;
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
  const { data, error } = await supabase.rpc("admin_remove_from_marketplace", { target });
  if (error) {
    redirect(`${path}?error=${encodeURIComponent("The request could not be removed from the marketplace.")}`);
  }
  const code = typeof data === "string" ? data : "";
  if (code === "removed" || code === "already_removed") {
    redirect(`${path}?removed=${code === "already_removed" ? "already" : "1"}`);
  }
  redirect(`${path}?error=${encodeURIComponent(marketplaceRemovalMessage(isMarketplaceRemovalCode(code) ? code : ""))}`);
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
