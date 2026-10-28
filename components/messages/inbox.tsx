import Link from "next/link";
import { BackLink } from "@/components/back-link";
import { ConversationContext } from "@/components/messages/conversation-context";
import { MessagePanel, type ChatMessage } from "@/components/messages/message-panel";
import { documentUploadHref, uploadLabel } from "@/lib/messages/documents";
import { statusLabel } from "@/components/request/job-status";
import { messageClock, previewSnippet, routeLabel, unreadLabel } from "@/lib/messages/preview";
import { createClient } from "@/lib/supabase/server";

type InboxRow = {
  thread_id: string;
  kind: string;
  title: string;
  unread: number;
  last_at: string | null;
  participant_name?: string | null;
  participant_role?: string | null;
  job_label?: string | null;
  pickup_label?: string | null;
  dropoff_label?: string | null;
  job_status?: string | null;
  snippet?: string | null;
  job_id?: string | null;
};

export async function MessageInbox({
  backHref,
  backLabel,
  listHref,
  threadId,
}: {
  backHref: string;
  backLabel: string;
  listHref: string;
  threadId: string | null;
}) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("my_inbox");
  const rows = (data ?? []) as InboxRow[];
  const selected = threadId && /^[0-9a-f-]{36}$/i.test(threadId) ? rows.find((row) => row.thread_id === threadId) : null;

  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-4 py-8">
      <BackLink href={selected ? listHref : backHref} label={selected ? "Messages" : backLabel} />
      <p className="text-sm font-semibold tracking-wide text-brand uppercase">Messages</p>
      <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight text-ink">
        {selected ? (selected.participant_name ?? selected.title) : "Messages"}
      </h1>
      {error ? (
        <p role="alert" className="mt-6 text-lg text-danger">
          We couldn&apos;t load your messages. Try again.
        </p>
      ) : selected ? (
        <Conversation row={selected} listHref={listHref} />
      ) : rows.length === 0 ? (
        <section className="mt-8 rounded-3xl bg-paper-raised p-5 ring-1 ring-line">
          <h2 className="text-xl font-semibold text-ink">No conversations yet</h2>
          <p className="mt-2 text-base leading-relaxed text-muted">
            Job chats open after a driver is assigned. Pickuply Support appears here when there is a message for you.
          </p>
        </section>
      ) : (
        <ul className="mt-6 grid gap-3">
          {rows.map((row) => (
            <li key={row.thread_id}>
              <Link
                href={`${listHref}?thread=${row.thread_id}`}
                className="flex min-h-12 items-center justify-between gap-3 rounded-3xl bg-paper-raised p-4 ring-1 ring-line"
              >
                <span className="min-w-0">
                  <span className={`block text-lg text-ink ${row.unread > 0 ? "font-bold" : "font-semibold"}`}>
                    {row.participant_name ?? row.title} — {row.participant_role ?? "Chat"}
                  </span>
                  <span className="mt-1 block truncate text-sm text-muted">
                    {[row.job_label, routeLabel(row.pickup_label, row.dropoff_label)].filter(Boolean).join(" · ") || row.title}
                  </span>
                  <span className="mt-1 block truncate text-base text-ink">
                    {row.snippet ? `"${previewSnippet(row.snippet)}"` : "No messages yet."}
                  </span>
                  <span className="mt-1 block text-sm text-muted">
                    {[
                      row.job_status ? statusLabel(row.job_status) : "",
                      unreadLabel(Number(row.unread ?? 0)) || "Read",
                      messageClock(row.last_at),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
                {row.unread > 0 ? (
                  <span className="rounded-full bg-brand px-2 py-1 text-sm font-semibold text-white">
                    {row.unread}
                  </span>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

async function Conversation({ row, listHref }: { row: InboxRow; listHref: string }) {
  const threadId = row.thread_id;
  const support = row.kind === "support";
  const jobHref = row.job_id
    ? listHref.startsWith("/driver")
      ? `/driver/jobs/${row.job_id}`
      : `/jobs/${row.job_id}`
    : null;
  const supabase = await createClient();
  await supabase.rpc("mark_thread_read", { target_thread: threadId });
  const [{ data: messages }, { data: thread }, { data: reviews }, { data: files }] = await Promise.all([
    supabase.rpc("thread_messages", { target_thread: threadId }),
    supabase.from("message_threads").select("closes_at, resolved_at").eq("id", threadId).maybeSingle(),
    support
      ? supabase.from("driver_item_reviews").select("item").not("note", "is", null)
      : Promise.resolve({ data: [] }),
    supabase.from("message_attachments").select("id, storage_path").eq("thread_id", threadId),
  ]);
  const attachments = await Promise.all(
    (files ?? []).map(async (file) => {
      const signed = await supabase.storage.from("message-files").createSignedUrl(file.storage_path, 300);
      return { id: file.id, url: signed.data?.signedUrl ?? null };
    }),
  );
  const closedAt = thread?.resolved_at ?? thread?.closes_at ?? null;

  return (
    <>
      {(reviews ?? []).length > 0 ? (
        <ul className="mt-4 grid gap-2">
          {(reviews ?? []).map((review) => {
            const href = documentUploadHref[review.item];
            if (!href) return null;
            return (
              <li key={review.item}>
                <Link href={href} className="inline-flex min-h-12 items-center font-semibold text-brand">
                  {uploadLabel(review.item)}
                </Link>
              </li>
            );
          })}
        </ul>
      ) : null}
      <ConversationContext
        name={row.participant_name ?? row.title}
        role={row.participant_role ?? "Chat"}
        jobLabel={row.job_label ?? null}
        pickup={row.pickup_label ?? null}
        dropoff={row.dropoff_label ?? null}
        status={row.job_status ?? null}
        jobHref={jobHref}
      />
      <MessagePanel
        threadId={threadId}
        initial={(messages ?? []) as ChatMessage[]}
        closesAt={closedAt}
        attachments={attachments.filter((file) => file.url)}
      />
    </>
  );
}
