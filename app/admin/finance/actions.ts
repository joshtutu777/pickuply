"use server";

import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export async function saveFinanceView(formData: FormData) {
  const session = await requireAdmin("/admin/finance");
  const query = String(formData.get("query") ?? "").slice(0, 4000);
  const supabase = await createClient();
  const { error } = await supabase.from("admin_finance_views").upsert({
    admin_id: session.userId,
    query,
    updated_at: new Date().toISOString(),
  });
  if (error) redirect("/admin/finance?error=save");
  redirect(query ? `/admin/finance?${query}` : "/admin/finance");
}

export async function clearFinanceView() {
  const session = await requireAdmin("/admin/finance");
  const supabase = await createClient();
  await supabase.from("admin_finance_views").delete().eq("admin_id", session.userId);
  redirect("/admin/finance?fresh=1");
}
