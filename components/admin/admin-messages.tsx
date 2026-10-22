import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

type ThreadSummary = {
  thread_id: string;
  kind: string;
  label: string;
  unread: number;
  last_at: string | null;
};

export async function AdminMessageList() {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_open_threads");
  if (error) return null;
  const threads = (data ?? []) as ThreadSummary[];

  return (
    <section className="order-4" aria-labelledby="messages-heading">
      <h2 id="messages-heading" className="font-display text-3xl font-semibold text-ink">
        Messages
      </h2>
      {threads.length === 0 ? (
        <p className="mt-4 text-base text-muted">No open conversations.</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {threads.map((thread) => (
            <li key={thread.thread_id} className="rounded-3xl bg-paper-raised p-4 ring-1 ring-line">
              <Link href={`/admin/messages/${thread.thread_id}`} className="block min-h-12">
                <p className="text-lg font-semibold text-ink">{thread.label}</p>
                <p className="text-base text-muted">
                  {thread.unread === 1 ? "1 unread" : `${thread.unread} unread`}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
