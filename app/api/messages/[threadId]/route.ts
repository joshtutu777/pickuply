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

async function loadMessages(threadId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  await supabase.rpc("mark_thread_read", { target_thread: threadId });
  const { data, error } = await supabase.rpc("thread_messages", { target_thread: threadId });
  if (error) return null;
  return (data ?? []) as ChatMessage[];
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ threadId: string }> },
) {
  await connection();
  const { threadId } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(threadId)) {
    return NextResponse.json({ messages: [] }, { status: 400 });
  }
  const messages = await loadMessages(threadId);
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
  try {
    const payload = (await request.json()) as { body?: unknown };
    body = typeof payload.body === "string" ? payload.body : "";
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("post_message", {
    target_thread: threadId,
    message_body: body,
  });
  if (error) return NextResponse.json({ ok: false }, { status: 400 });
  const messages = await loadMessages(threadId);
  return NextResponse.json({ messages: messages ?? [] });
}
