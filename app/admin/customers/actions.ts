"use server";

import { connection } from "next/server";
import { redirect } from "next/navigation";
import { customerRemovalMessage, isCustomerRemovalCode } from "@/lib/admin/customer-removal";
import { createClient } from "@/lib/supabase/server";

function customerPath(value: FormDataEntryValue | null): string {
  const path = String(value ?? "");
  if (!/^\/admin\/customers\/[0-9a-f-]{36}$/i.test(path)) return "/admin/customers";
  return path;
}

export async function removeCustomer(formData: FormData) {
  await connection();
  const path = customerPath(formData.get("returnTo"));
  const target = String(formData.get("profileId") ?? "");
  if (formData.get("confirm") !== "yes") {
    redirect(`${path}?error=${encodeURIComponent("Confirm the customer before deleting the account.")}`);
  }
  if (!/^[0-9a-f-]{36}$/i.test(target)) {
    redirect(`${path}?error=${encodeURIComponent("Choose a customer.")}`);
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_remove_customer", { target });
  if (error) {
    redirect(`${path}?error=${encodeURIComponent("The account could not be deleted.")}`);
  }
  const code = typeof data === "string" ? data : "";
  if (code === "removed" || code === "already_removed") {
    redirect(`${path}?removed=${code === "already_removed" ? "already" : "1"}`);
  }
  redirect(`${path}?error=${encodeURIComponent(customerRemovalMessage(isCustomerRemovalCode(code) ? code : ""))}`);
}
