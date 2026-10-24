"use server";

import { connection } from "next/server";
import { redirect } from "next/navigation";
import { resolveTestLane } from "@/lib/admin/test-lane-server";
import { createClient } from "@/lib/supabase/server";

export async function cleanupTestData(formData: FormData) {
  await connection();
  const lane = await resolveTestLane(false);
  if (lane !== "real") redirect("/admin/test-data?error=forbidden");
  const confirmation = String(formData.get("confirmation") ?? "");
  if (confirmation !== "DELETE TEST DATA") redirect("/admin/test-data?error=confirm");
  const supabase = await createClient();
  const { error } = await supabase.rpc("cleanup_test_data", { confirmation });
  if (error) redirect("/admin/test-data?error=save");
  redirect("/admin/test-data?done=1");
}
