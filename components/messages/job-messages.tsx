import "server-only";

import { MessagePanel, type ChatMessage } from "@/components/messages/message-panel";
import { createClient } from "@/lib/supabase/server";

export async function JobMessages({
  jobId,
  showQuickReplies = false,
}: {
  jobId: string;
  showQuickReplies?: boolean;
}) {
  const supabase = await createClient();
  const { data: threadId } = await supabase.rpc("job_thread", { target_job: jobId });
  if (!threadId) return null;
  const [{ data }, { data: thread }] = await Promise.all([
    supabase.rpc("thread_messages", { target_thread: threadId }),
    supabase.from("message_threads").select("closes_at, resolved_at").eq("id", threadId).maybeSingle(),
  ]);
  const closedAt = thread?.resolved_at ?? thread?.closes_at ?? null;
  return (
    <>
    <p className="mt-4 text-base text-muted">For your safety, contact details can&apos;t be shared in chat. This conversation closes when the job is completed or cancelled.</p>
    <MessagePanel
      threadId={threadId}
      initial={(data ?? []) as ChatMessage[]}
      closesAt={closedAt}
      showQuickReplies={showQuickReplies}
      reportHref={`/help?job=${jobId}#report`}
    />
    </>
  );
}
