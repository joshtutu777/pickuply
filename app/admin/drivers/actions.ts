"use server";

import { connection } from "next/server";
import { redirect } from "next/navigation";
import { recordFunnelServer } from "@/lib/funnel-server";
import { createClient } from "@/lib/supabase/server";

const decisions = new Set([
  "approve_new",
  "approve_active",
  "request_changes",
  "decline",
  "pause",
  "remove",
]);

export async function reviewDriver(formData: FormData) {
  await connection();
  const driverId = String(formData.get("driverId") ?? "");
  const decision = String(formData.get("decision") ?? "");
  const note = String(formData.get("note") ?? "");
  if (!decisions.has(decision)) {
    redirect("/admin/drivers?error=1");
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("review_driver", {
    target_driver: driverId,
    decision,
    note,
  });
  if (error) {
    redirect(`/admin/drivers/${driverId}?error=${encodeURIComponent(error.message)}`);
  }
  if (decision === "approve_new" || decision === "approve_active") {
    await recordFunnelServer({ event: "driver_approved", step: decision });
  }
  redirect(`/admin/drivers/${driverId}?saved=1`);
}

export async function reopenDriver(formData: FormData) {
  await connection();
  const driverId = String(formData.get("driverId") ?? "");
  const supabase = await createClient();
  const { error } = await supabase.rpc("reopen_driver_application", { target_driver: driverId });
  if (error) {
    redirect(`/admin/drivers/${driverId}?error=${encodeURIComponent(error.message)}`);
  }
  redirect(`/admin/drivers/${driverId}?saved=1`);
}

export async function approveVehicle(formData: FormData) {
  await connection();
  const driverId = String(formData.get("driverId") ?? "");
  const supabase = await createClient();
  const { error } = await supabase.rpc("approve_driver_vehicle", { target_driver: driverId });
  if (error) {
    redirect(`/admin/drivers/${driverId}?error=${encodeURIComponent(error.message)}`);
  }
  redirect(`/admin/drivers/${driverId}?saved=1`);
}
