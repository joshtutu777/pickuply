import { connection } from "next/server";
import { mapTwilioStatus, providerErrorCode } from "@/lib/sms/center";
import { twilioSignatureValid } from "@/lib/sms/signature";
import { createServiceClient } from "@/lib/supabase/service";

/** Twilio delivery updates. A repeated callback does not create a second message. */
export async function POST(request: Request) {
  await connection();
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!token) return new Response("unavailable", { status: 503 });
  const raw = await request.text();
  const params = new URLSearchParams(raw);
  const signature = request.headers.get("x-twilio-signature") ?? "";
  if (!twilioSignatureValid(request.url, params, token, signature)) {
    return new Response("unauthorized", { status: 401 });
  }
  const sid = params.get("MessageSid") ?? "";
  if (!sid) return new Response("ok");
  try {
    const supabase = createServiceClient();
    const delivery = mapTwilioStatus(params.get("MessageStatus"));
    await supabase.rpc("record_sms_delivery", {
      provider_sid: sid,
      next_status: delivery,
      error_code: providerErrorCode(params.get("ErrorCode")),
    });
    await supabase.rpc("record_payment_reminder_delivery", {
      provider_sid: sid,
      next_status: delivery,
    });
  } catch {
    return new Response("unavailable", { status: 503 });
  }
  return new Response("ok");
}
