import "server-only";

import { requireAdmin } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { laneFromViewer, type TestLane } from "@/lib/admin/test-lane";

export async function resolveTestLane(requested: boolean): Promise<TestLane> {
  const session = await requireAdmin("/admin");
  const supabase = await createClient();
  const { data } = await supabase.from("profiles").select("is_test").eq("id", session.userId).maybeSingle();
  return laneFromViewer(data?.is_test === true, requested);
}
