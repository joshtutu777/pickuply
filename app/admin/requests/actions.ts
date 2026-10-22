"use server";

import { connection } from "next/server";
import { redirect } from "next/navigation";
import { parseDollarsToCents } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";

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
