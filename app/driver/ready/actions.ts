"use server";

import { connection } from "next/server";
import { redirect } from "next/navigation";
import { recordFunnelServer } from "@/lib/funnel-server";
import { createClient } from "@/lib/supabase/server";

function fail(step: string, message: string): never {
  redirect(`/driver/ready/${step}?error=${encodeURIComponent(message)}`);
}

export async function saveInsurance(formData: FormData) {
  await connection();
  const supabase = await createClient();
  const { error } = await supabase.rpc("save_driver_insurance", {
    doc_path: String(formData.get("path") ?? ""),
    expires: String(formData.get("expires") ?? ""),
  });
  if (error) fail("insurance", error.message);
  await recordFunnelServer({ event: "driver_checklist", step: "insurance" });
  redirect("/driver?saved=insurance");
}

export async function saveVehicle(formData: FormData) {
  await connection();
  const supabase = await createClient();
  const { error } = await supabase.rpc("save_driver_vehicle", {
    make: String(formData.get("make") ?? ""),
    model: String(formData.get("model") ?? ""),
    vehicle_year: Number(formData.get("year")),
    plate: String(formData.get("plate") ?? ""),
    cargo_length: Number(formData.get("cargo")),
    photo_path: String(formData.get("path") ?? ""),
  });
  if (error) fail("vehicle", error.message);
  await recordFunnelServer({ event: "driver_checklist", step: "vehicle" });
  redirect("/driver?saved=vehicle");
}

export async function saveKit(formData: FormData) {
  await connection();
  const equipment = formData.getAll("equipment").map(String);
  const supabase = await createClient();
  const { error } = await supabase.rpc("save_driver_kit", {
    chosen_equipment: equipment,
    helper: String(formData.get("helper") ?? ""),
    helper_phone: String(formData.get("helperPhone") ?? ""),
  });
  if (error) fail("equipment", error.message);
  await recordFunnelServer({ event: "driver_checklist", step: "equipment" });
  redirect("/driver?saved=equipment");
}

export async function saveServices(formData: FormData) {
  await connection();
  const supabase = await createClient();
  const { error } = await supabase.rpc("save_driver_services", {
    chosen: formData.getAll("service").map(String),
    level: String(formData.get("level") ?? ""),
  });
  if (error) fail("services", error.message);
  await recordFunnelServer({ event: "driver_checklist", step: "services" });
  redirect("/driver?saved=services");
}

export async function signAgreement(formData: FormData) {
  await connection();
  const supabase = await createClient();
  const { error } = await supabase.rpc("sign_driver_agreement", {
    signature: String(formData.get("signature") ?? ""),
  });
  if (error) fail("agreement", error.message);
  await recordFunnelServer({ event: "driver_checklist", step: "agreement" });
  redirect("/driver?saved=agreement");
}

export async function completeTraining() {
  await connection();
  const supabase = await createClient();
  const { error } = await supabase.rpc("complete_driver_training");
  if (error) fail("training", error.message);
  await recordFunnelServer({ event: "driver_checklist", step: "training" });
  redirect("/driver?saved=training");
}
