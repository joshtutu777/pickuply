"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export async function saveSmsSetting(formData: FormData) {
  await requireAdmin("/admin/settings");
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_sms_enabled", {
    enabled: formData.get("smsEnabled") === "on",
  });
  revalidatePath("/admin/settings");
  redirect(error ? "/admin/settings?error=Could%20not%20save%20text%20messages" : "/admin/settings?saved=1");
}
