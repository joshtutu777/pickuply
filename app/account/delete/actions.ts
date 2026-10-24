"use server";

import { connection } from "next/server";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function requestDeletion(formData: FormData) {
  await connection();
  const confirmed = formData.get("confirm") === "on";
  const typed = String(formData.get("phrase") ?? "");
  if (!confirmed || typed !== "DELETE") {
    redirect("/account/delete?error=confirm");
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("request_account_deletion");
  if (error) {
    const phone = error.message.includes("confirm your phone again");
    redirect(phone ? "/account/delete?error=phone" : "/account/delete?error=1");
  }
  redirect(data === "completed" ? "/account/delete?saved=completed" : "/account/delete?saved=pending");
}

export async function cancelDeletion() {
  await connection();
  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_account_deletion");
  if (error) {
    const phone = error.message.includes("confirm your phone again");
    redirect(phone ? "/account/delete?error=phone" : "/account/delete?error=cancel");
  }
  redirect("/account/delete?saved=cancelled");
}
