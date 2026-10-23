import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { BackLink } from "@/components/back-link";
import { MessagePanel, type ChatMessage } from "@/components/messages/message-panel";
import { LoadingMain } from "@/components/loading-main";
import { requireSignedIn } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Support" };

export default function SupportPage() {
  return (
    <Suspense fallback={<LoadingMain />}>
      <Support />
    </Suspense>
  );
}

async function Support() {
  await requireSignedIn("/support");
  const supabase = await createClient();
  const { data: threadId, error } = await supabase.rpc("open_support_thread");
  const { data: messages } = threadId
    ? await supabase.rpc("thread_messages", { target_thread: threadId })
    : { data: [] };

  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-4 py-8">
      <BackLink href="/help" label="Help" />
      <p className="text-sm font-semibold tracking-wide text-brand uppercase">Support</p>
      <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight text-ink">Pickuply Support</h1>
      <p className="mt-3 text-base text-muted">Phone numbers and emails typed here are hidden. Share pickup details in the app.</p>
      {error || !threadId ? (
        <p className="mt-6 text-base text-ink">
          Use Help to contact Pickuply. You can reply here after Pickuply messages you.{" "}
          <Link href="/help" className="font-semibold text-brand">
            Help
          </Link>
        </p>
      ) : (
        <MessagePanel threadId={threadId} initial={(messages ?? []) as ChatMessage[]} closesAt={null} />
      )}
    </main>
  );
}
