"use server";

import { connection } from "next/server";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function stopDriving(formData: FormData) {
  await connection();
  const confirmed = formData.get("confirm") === "on";
  const typed = String(formData.get("phrase") ?? "");
  if (!confirmed || typed !== "STOP") {
    redirect("/account/stop-driving?error=confirm");
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("stop_driving");
  if (error) {
    const phone = error.message.includes("confirm your phone again");
    const missing = error.message.includes("this account is not a driver");
    redirect(phone ? "/account/stop-driving?error=phone" : missing ? "/account/stop-driving?error=driver" : "/account/stop-driving?error=1");
  }
  redirect(data === "pending" ? "/account/stop-driving?saved=pending" : "/account/stop-driving?saved=stopped");
}
