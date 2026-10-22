import type { Metadata } from "next";
import { Suspense } from "react";
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
  const { data: settings } = await supabase
    .from("platform_settings")
    .select("support_phone, support_email")
    .eq("id", 1)
    .maybeSingle();
  const { data: messages } = threadId
    ? await supabase.rpc("thread_messages", { target_thread: threadId })
    : { data: [] };

  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-4 py-8">
      <p className="text-sm font-semibold tracking-wide text-brand uppercase">Support</p>
      <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight text-ink">Contact support</h1>
      {settings?.support_phone ? <p className="mt-3 text-base text-ink">Phone: {settings.support_phone}</p> : null}
      {settings?.support_email ? <p className="text-base text-ink">Email: {settings.support_email}</p> : null}
      {!settings?.support_phone && !settings?.support_email ? (
        <p className="mt-3 text-base text-muted">Support contact will appear here once Pickuply adds it.</p>
      ) : null}
      {error || !threadId ? (
        <p role="alert" className="mt-6 text-lg text-danger">
          We couldn&apos;t open support. Try again.
        </p>
      ) : (
        <MessagePanel threadId={threadId} initial={(messages ?? []) as ChatMessage[]} closed={false} />
      )}
    </main>
  );
}
