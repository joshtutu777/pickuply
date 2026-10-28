import { MessageDock } from "@/components/messages/message-dock";
import { messageClock, previewSnippet, unreadLabel } from "@/lib/messages/preview";
import { createClient } from "@/lib/supabase/server";

type Summary = {
  thread_id: string;
  participant_name: string;
  participant_role: string;
  unread: number;
  snippet: string | null;
  last_at: string | null;
};

export async function JobMessageCard({
  jobId,
  audience,
}: {
  jobId: string;
  audience: "customer" | "driver";
}) {
  const supabase = await createClient();
  const { data } = await supabase.rpc("job_message_summary", { target_job: jobId });
  const row = ((data ?? []) as Summary[])[0];
  if (!row?.thread_id) return null;
  const label = audience === "customer" ? "Message Driver" : "Message Customer";
  const unread = Number(row.unread ?? 0);
  const snippet = previewSnippet(row.snippet);
  const when = messageClock(row.last_at);

  return (
    <>
      <a
        id="message-launch"
        href="#messages"
        className="mt-3 flex min-h-12 flex-col justify-center rounded-3xl bg-paper-raised px-4 py-3 ring-1 ring-line"
      >
        <span className="flex items-center justify-between gap-3">
          <span className="text-base font-semibold text-ink">{label}</span>
          {unread > 0 ? (
            <span className="rounded-full bg-brand px-2 py-1 text-sm font-semibold text-white">{unreadLabel(unread)}</span>
          ) : null}
        </span>
        <span className="mt-1 text-sm text-muted">
          {row.participant_name} — {row.participant_role}
        </span>
        <span className="mt-1 line-clamp-1 text-base text-ink">{snippet ? `"${snippet}"` : "No messages yet."}</span>
        {when ? <span className="mt-1 text-sm text-muted">{when}</span> : null}
      </a>
      <MessageDock label={label} unread={unread} href="#messages" />
    </>
  );
}
