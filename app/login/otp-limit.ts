"use server";

import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { createServiceClient } from "@/lib/supabase/service";

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export async function allowOtpSend(phone: string): Promise<string | null> {
  const headerStore = await headers();
  const ip = headerStore.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const supabase = createServiceClient();
  const phoneLimit = await supabase.rpc("consume_rate_limit", {
    scope: "otp-phone",
    actor_key: digest(phone),
    max_count: 5,
    window_seconds: 3600,
    message: "Too many codes for this number. Try again in an hour.",
  });
  if (phoneLimit.error) return "Too many codes for this number. Try again in an hour.";
  const ipLimit = await supabase.rpc("consume_rate_limit", {
    scope: "otp-ip",
    actor_key: digest(ip),
    max_count: 10,
    window_seconds: 3600,
    message: "Too many codes from this network. Try again in an hour.",
  });
  if (ipLimit.error) return "Too many codes from this network. Try again in an hour.";
  return null;
}
