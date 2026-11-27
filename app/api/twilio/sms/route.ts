import { connection } from "next/server";
import { inboundKeyword, inboundReply } from "@/lib/sms/center";
import { twilioSignatureValid } from "@/lib/sms/signature";
import { createServiceClient } from "@/lib/supabase/service";

function reply(message: string) {
  const body = message.replace(/[<>&]/g, (character) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[character] ?? character);
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><Response><Message>${body}</Message></Response>`, {
    headers: { "Content-Type": "text/xml" },
  });
}

function emptyReply() {
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><Response/>`, {
    headers: { "Content-Type": "text/xml" },
  });
}

/** Inbound texts. Sign-in codes are not sent from here. */
export async function POST(request: Request) {
  await connection();
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!token) return reply("Text help is not available. Email info@pickuplyapp.com.");

  const raw = await request.text();
  const params = new URLSearchParams(raw);
  const signature = request.headers.get("x-twilio-signature") ?? "";
  if (!twilioSignatureValid(request.url, params, token, signature)) {
    return new Response("unauthorized", { status: 401 });
  }

  const keyword = inboundKeyword(params.get("Body") ?? "");
  const phone = params.get("From") ?? "";
  const sid = params.get("MessageSid") ?? "";
  try {
    const supabase = createServiceClient();
    if (keyword === "stop") await supabase.rpc("record_sms_opt_out", { target_phone: phone });
    if (keyword === "start") await supabase.rpc("record_sms_opt_in", { target_phone: phone });
    const { data, error } = await supabase.rpc("record_inbound_sms", {
      target_phone: phone,
      body: params.get("Body") ?? "",
      provider_sid: sid,
      keyword,
    });
    if (error) return reply("We could not save that message. Email info@pickuplyapp.com.");
    if (data === true) return emptyReply();
  } catch {
    return reply("We could not save that message. Email info@pickuplyapp.com.");
  }
  return reply(inboundReply(keyword));
}
