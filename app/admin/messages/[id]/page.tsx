import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { BackLink } from "@/components/back-link";
import { MessagePanel, type ChatMessage } from "@/components/messages/message-panel";
import { LoadingMain } from "@/components/loading-main";
import { requireAdmin } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: { absolute: "Message · Pickuply Admin" } };

export default function AdminMessagePage({ params }: PageProps<"/admin/messages/[id]">) {
  return (
    <Suspense fallback={<LoadingMain />}>
      <AdminMessage params={params} />
    </Suspense>
  );
}

async function AdminMessage({ params }: { params: PageProps<"/admin/messages/[id]">["params"] }) {
  await requireAdmin("/admin");
  const { id } = await params;
  const supabase = await createClient();
  const { data: thread } = await supabase
    .from("message_threads")
    .select("id, closes_at")
    .eq("id", id)
    .maybeSingle();
  if (!thread) notFound();
  const { data } = await supabase.rpc("thread_messages", { target_thread: id });
  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-4 py-8">
      <BackLink href="/admin" label="Admin" />
      <h1 className="font-display text-4xl font-semibold text-ink">Message</h1>
      <MessagePanel threadId={id} initial={(data ?? []) as ChatMessage[]} closesAt={thread.closes_at} />
    </main>
  );
}
