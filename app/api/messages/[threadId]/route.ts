import { connection } from "next/server";
import { NextResponse } from "next/server";
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
  const { error } = await supabase.rpc("post_message_once", {
    target_thread: threadId,
    message_body: body,
    client_key: clientKey,
  });
  if (error) return NextResponse.json({ ok: false }, { status: 400 });
  const messages = await loadMessages(threadId, true);
  return NextResponse.json({ messages: messages ?? [] });
}
