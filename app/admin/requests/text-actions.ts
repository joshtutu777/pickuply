"use server";

import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth/session";
import { queueDriverFollowup } from "@/lib/notifications/transactional-send";

export async function textEligibleDrivers(formData: FormData) {
  await requireAdmin("/admin/requests");
  const jobId = String(formData.get("jobId") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(jobId)) redirect("/admin/requests");
  try {
    const result = await queueDriverFollowup(jobId);
    if ("error" in result) redirect(`/admin/requests/${jobId}?error=${encodeURIComponent(result.error)}`);
    redirect(`/admin/requests/${jobId}?texted=${result.sent}`);
  } catch {
    redirect(`/admin/requests/${jobId}?error=${encodeURIComponent("Could not send the follow-up")}`);
  }
}
