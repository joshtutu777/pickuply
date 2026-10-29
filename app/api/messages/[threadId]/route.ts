import { connection } from "next/server";
import { NextResponse } from "next/server";
import { flagOffPlatformAttempt } from "@/lib/messages/flag-off-platform";
import { redirectsPayment } from "@/lib/messages/payment-redirect";
import { createClient } from "@/lib/supabase/server";

type ChatMessage = {
  id: string;
  body: string;
  created_at: string;
  mine: boolean;
  sender_name: string;
};

async function loadMessages(threadId: string, mark: boolean) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  if (mark) await supabase.rpc("mark_thread_read", { target_thread: threadId });
  const { data, error } = await supabase.rpc("thread_messages", { target_thread: threadId });
  if (error) return null;
  return (data ?? []) as ChatMessage[];
}

export async function GET(
  request: Request,
  context: { params: Promise<{ threadId: string }> },
) {
  await connection();
  const { threadId } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(threadId)) {
    return NextResponse.json({ messages: [] }, { status: 400 });
  }
  const mark = new URL(request.url).searchParams.get("mark") === "1";
  const messages = await loadMessages(threadId, mark);
  if (!messages) return NextResponse.json({ messages: [] }, { status: 401 });
  return NextResponse.json({ messages });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ threadId: string }> },
) {
  await connection();
  const { threadId } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(threadId)) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  let body = "";
  let clientKey = "";
  try {
    const payload = (await request.json()) as { body?: unknown; clientKey?: unknown };
    body = typeof payload.body === "string" ? payload.body : "";
    clientKey = typeof payload.clientKey === "string" ? payload.clientKey : "";
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  if (!/^[0-9a-f-]{36}$/i.test(clientKey)) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false }, { status: 401 });
  if (redirectsPayment(body)) {
    try {
      await flagOffPlatformAttempt(user.id, threadId);
    } catch {
      // The message is still rejected when the alert cannot be stored.
    }
    return NextResponse.json({ ok: false, error: "payment" }, { status: 400 });
  }
  const { error } = await supabase.rpc("post_message_once", {
    target_thread: threadId,
    message_body: body,
    client_key: clientKey,
  });
  if (error) {
    const message = error.message ?? "";
    if (message.includes("contact details")) {
      return NextResponse.json({ ok: false, error: "contact" }, { status: 400 });
    }
    if (message.includes("Payments must go through Pickuply")) {
      try {
        await flagOffPlatformAttempt(user.id, threadId);
      } catch {
        // The message is still rejected when the alert cannot be stored.
      }
      return NextResponse.json({ ok: false, error: "payment" }, { status: 400 });
    }
    if (message.includes("conversation is closed")) {
      return NextResponse.json({ ok: false, error: "closed" }, { status: 400 });
    }
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const messages = await loadMessages(threadId, true);
  return NextResponse.json({ messages: messages ?? [] });
}
