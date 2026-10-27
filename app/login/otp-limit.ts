"use server";

import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { mapOtpError, otpErrorCopy } from "@/lib/auth/otp-errors";
import { otpSendLimits } from "@/lib/auth/otp-send-limit";
import { normalizeUsPhone } from "@/lib/phone";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function allowOtpSend(phone: string): Promise<string | null> {
  const headerStore = await headers();
  const ip = headerStore.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const supabase = createServiceClient();
  const phoneLimit = await supabase.rpc("consume_rate_limit", {
    scope: otpSendLimits.phone.scope,
    actor_key: digest(phone),
    max_count: otpSendLimits.phone.max,
    window_seconds: otpSendLimits.phone.windowSeconds,
    message: otpSendLimits.phone.message,
  });
  if (phoneLimit.error) return otpSendLimits.phone.message;
  const ipLimit = await supabase.rpc("consume_rate_limit", {
    scope: otpSendLimits.ip.scope,
    actor_key: digest(ip),
    max_count: otpSendLimits.ip.max,
    window_seconds: otpSendLimits.ip.windowSeconds,
    message: otpSendLimits.ip.message,
  });
  if (ipLimit.error) return otpSendLimits.ip.message;
  return null;
}

export async function sendSignInCode(phone: string): Promise<string | null> {
  const normalized = normalizeUsPhone(phone);
  if (!normalized) return otpErrorCopy.invalidNumber;

  const limited = await allowOtpSend(normalized);
  if (limited) return limited;

  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.signInWithOtp({
      phone: normalized,
      options: { channel: "sms" },
    });
    if (error) return mapOtpError(error, "send");
    return null;
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : "";
    const name = caught instanceof Error ? caught.name : "";
    return mapOtpError({ message, name }, "send");
  }
}
