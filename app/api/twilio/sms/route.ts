import { createHmac, timingSafeEqual } from "node:crypto";
import { connection } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";

const stopWords = new Set(["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"]);

function twilioSignature(url: string, params: URLSearchParams, token: string): string {
  const pairs = [...params.entries()].sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  let payload = url;
  for (const [key, value] of pairs) payload += key + value;
  return createHmac("sha1", token).update(payload).digest("base64");
}

function signaturesMatch(expected: string, received: string): boolean {
  const left = Buffer.from(expected);
  const right = Buffer.from(received);
  return left.length === right.length && timingSafeEqual(left, right);
}

function reply(message: string) {
  const body = message.replace(/[<>&]/g, (character) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[character] ?? character);
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><Response><Message>${body}</Message></Response>`, {
    headers: { "Content-Type": "text/xml" },
  });
}

/** Inbound STOP and HELP. Optional texts only. The sign-in code is not sent from here. */
export async function POST(request: Request) {
  await connection();
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!token) return reply("Text help is not available. Email info@pickuplyapp.com.");

  const raw = await request.text();
  const params = new URLSearchParams(raw);
  const signature = request.headers.get("x-twilio-signature") ?? "";
  const expected = twilioSignature(request.url, params, token);
  if (!signature || !signaturesMatch(expected, signature)) {
    return new Response("unauthorized", { status: 401 });
  }

  const word = (params.get("Body") ?? "").trim().toUpperCase();
  const phone = params.get("From") ?? "";
  if (stopWords.has(word)) {
    try {
      const supabase = createServiceClient();
      const { error } = await supabase.rpc("record_sms_opt_out", { target_phone: phone });
      if (error) return reply("We could not save that opt-out. Email info@pickuplyapp.com.");
    } catch {
      return reply("We could not save that opt-out. Email info@pickuplyapp.com.");
    }
    return reply("You are unsubscribed from optional Pickuply texts. Sign-in codes are separate.");
  }
  if (word === "HELP" || word === "INFO") {
    return reply("Pickuply optional texts. Reply STOP to opt out. Email info@pickuplyapp.com for help.");
  }
  return reply("Pickuply received your message. Reply HELP for help or STOP to opt out.");
}
