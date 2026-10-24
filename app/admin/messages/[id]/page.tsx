import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { resolveSupportThread } from "@/app/admin/messages/actions";
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
    .select("id, kind, closes_at, resolved_at, requester_id, driver_id")
    .eq("id", id)
    .maybeSingle();
  if (!thread) notFound();
  const { data } = await supabase.rpc("thread_messages", { target_thread: id });
  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-4 py-8">
      <BackLink href="/admin/messages" label="Messages" />
      <h1 className="font-display text-4xl font-semibold text-ink">Message</h1>
      <p className="mt-3 flex flex-wrap gap-4">
        {thread.requester_id ? (
          <Link href={`/admin/customers/${thread.requester_id}`} className="inline-flex min-h-12 items-center font-semibold text-brand">
            Customer
          </Link>
        ) : null}
        {thread.driver_id ? (
          <Link href={`/admin/drivers/${thread.driver_id}`} className="inline-flex min-h-12 items-center font-semibold text-brand">
            Driver
          </Link>
        ) : null}
      </p>
      {thread.kind === "support" && !thread.resolved_at ? (
        <form action={resolveSupportThread} className="mt-4">
          <input type="hidden" name="threadId" value={id} />
          <button type="submit" className="inline-flex min-h-12 items-center justify-center rounded-full bg-ink px-6 font-semibold text-white">
            Mark resolved
          </button>
        </form>
      ) : null}
      {thread.resolved_at ? <p className="mt-4 text-base text-ink">This conversation is resolved and read-only.</p> : null}
      <MessagePanel threadId={id} initial={(data ?? []) as ChatMessage[]} closesAt={thread.resolved_at ?? thread.closes_at} />
    </main>
  );
}
