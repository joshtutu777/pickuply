"use server";

import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { deliverSignInCode } from "@/lib/auth/otp-send-flow";
import { mapOtpError, otpErrorCopy } from "@/lib/auth/otp-errors";
import { otpSendMessages } from "@/lib/auth/otp-send-limit";
import { isSyntheticOtpPhone } from "@/lib/auth/synthetic-otp";
import { normalizeUsPhone } from "@/lib/phone";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function knownLimitMessage(error: { message?: string } | null, fallback: string): string | null {
  const message = error?.message ?? "";
  if (message.includes(otpSendMessages.cooldown)) return otpSendMessages.cooldown;
  if (message.includes(otpSendMessages.phoneDaily)) return otpSendMessages.phoneDaily;
  if (message.includes(otpSendMessages.burst)) return otpSendMessages.burst;
  if (message.includes(otpSendMessages.sustained)) return otpSendMessages.sustained;
  if (message.includes(otpSendMessages.verify)) return otpSendMessages.verify;
  if (error) return fallback;
  return null;
}

async function clientIp(): Promise<string> {
  const headerStore = await headers();
  return headerStore.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
}

async function reserveSend(phone: string): Promise<string | null> {
  const supabase = createServiceClient();
  const reserved = await supabase.rpc("reserve_otp_send", {
    phone_key: digest(phone),
    ip_key: digest(await clientIp()),
  });
  return knownLimitMessage(reserved.error, otpErrorCopy.sendFailed);
}

async function providerSend(phone: string): Promise<string | null> {
  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.signInWithOtp({
      phone,
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

export async function sendSignInCode(phone: string): Promise<string | null> {
  const normalized = normalizeUsPhone(phone);
  if (!normalized) return otpErrorCopy.invalidNumber;
  return deliverSignInCode(normalized, { reserve: reserveSend, send: providerSend });
}

export async function prepareSignInVerify(phone: string): Promise<string | null> {
  const normalized = normalizeUsPhone(phone);
  if (!normalized) return otpErrorCopy.invalidNumber;
  if (isSyntheticOtpPhone(normalized)) return null;
  const supabase = createServiceClient();
  const allowed = await supabase.rpc("otp_verify_allowed", { phone_key: digest(normalized) });
  return knownLimitMessage(allowed.error, "We couldn't check that code. Try again.");
}

export async function noteSignInVerifyFailure(phone: string): Promise<void> {
  const normalized = normalizeUsPhone(phone);
  if (!normalized || isSyntheticOtpPhone(normalized)) return;
  const supabase = createServiceClient();
  await supabase.rpc("note_otp_verify_failure", { phone_key: digest(normalized) });
}
