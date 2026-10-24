"use client";

import { useEffect, useState, useSyncExternalStore, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { containsContact } from "@/lib/messages/contact";
import { compressImage } from "@/lib/photos";
import { createClient } from "@/lib/supabase/client";

export type ChatMessage = {
  id: string;
  body: string;
  created_at: string;
  mine: boolean;
  sender_name: string;
  seen?: boolean;
  action_href?: string | null;
};

export type ChatFile = { id: string; url: string | null };

const quickReplies = ["On my way", "Running 10 minutes late", "I'm outside", "Can't find the entrance"];

function emptySubscribe(): () => void {
  return () => undefined;
}

let messageClock = "";

function messageClockSnapshot(): string {
  if (messageClock.length === 0) messageClock = new Date().toISOString();
  return messageClock;
}

export function MessagePanel({
  threadId,
  initial,
  closesAt,
  showQuickReplies = false,
  attachments = [],
  reportHref = "/help",
}: {
  threadId: string;
  initial: ChatMessage[];
  closesAt: string | null;
  showQuickReplies?: boolean;
  attachments?: ChatFile[];
  reportHref?: string;
}) {
  const router = useRouter();
  const [messages, setMessages] = useState(initial);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const warning = containsContact(text);
  const nowIso = useSyncExternalStore(emptySubscribe, messageClockSnapshot, () => "");
  const closed = Boolean(closesAt && nowIso.length > 0 && closesAt <= nowIso);
  const lastMine = [...messages].reverse().find((message) => message.mine);

  async function addFile(file: File) {
    const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
    if (!["jpg", "jpeg", "png", "webp", "pdf"].includes(extension) || file.size > 5_000_000) {
      setError("Choose a photo or PDF under 5 MB.");
      return;
    }
    const image = extension !== "pdf";
    const body = image ? await compressImage(file) : file;
    const path = `${threadId}/${crypto.randomUUID()}.${image ? "jpg" : "pdf"}`;
    const supabase = createClient();
    const uploaded = await supabase.storage.from("message-files").upload(path, body, {
      upsert: false,
      contentType: image ? "image/jpeg" : "application/pdf",
    });
    if (uploaded.error) {
      setError("That file could not be uploaded.");
      return;
    }
    const registered = await supabase.rpc("register_message_file", {
      target_thread: threadId,
      storage_path: path,
    });
    if (registered.error) {
      setError("That file could not be sent.");
      return;
    }
    const response = await fetch(`/api/messages/${threadId}`);
    if (response.ok) {
      const payload = (await response.json()) as { messages?: ChatMessage[] };
      if (payload.messages) setMessages(payload.messages);
    }
    router.refresh();
  }

  useEffect(() => {
    const timer = window.setInterval(async () => {
      const response = await fetch(`/api/messages/${threadId}`);
      if (!response.ok) return;
      const payload = (await response.json()) as { messages?: ChatMessage[] };
      if (payload.messages) setMessages(payload.messages);
    }, 10000);
    return () => window.clearInterval(timer);
  }, [threadId]);

  async function send(event: FormEvent) {
    event.preventDefault();
    if (warning || closed || text.trim().length === 0) return;
    setError(null);
    const response = await fetch(`/api/messages/${threadId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: text }),
    });
    if (!response.ok) {
      setError("That message could not be sent.");
      return;
    }
    const payload = (await response.json()) as { messages?: ChatMessage[] };
    if (payload.messages) setMessages(payload.messages);
    setText("");
  }

  return (
    <section className="mt-6" aria-label="Messages">
      <h2 className="text-lg font-semibold text-ink">Messages</h2>
      {messages.length === 0 ? <p className="mt-2 text-base text-muted">No messages yet.</p> : null}
      {attachments.length > 0 ? (
        <ul className="mt-3 grid gap-2">
          {attachments.map((file) =>
            file.url ? (
              <li key={file.id}>
                <a href={file.url} className="inline-flex min-h-12 items-center font-semibold text-brand">
                  View file
                </a>
              </li>
            ) : null,
          )}
        </ul>
      ) : null}
      <ul className="mt-3 grid gap-2">
        {messages.map((message) => (
          <li key={message.id} className="rounded-2xl bg-paper-raised px-4 py-3 ring-1 ring-line">
            <p className="text-sm font-semibold text-muted">{message.sender_name}</p>
            <p className="whitespace-pre-wrap text-base text-ink">{message.body}</p>
            {message.action_href && /^\/jobs\/[0-9a-fA-F-]{36}\/edit$/.test(message.action_href) ? (
              <Link
                href={message.action_href}
                className="mt-3 inline-flex min-h-12 items-center justify-center rounded-full bg-brand px-6 font-semibold text-white"
              >
                Add details
              </Link>
            ) : null}
            <p className="text-sm text-muted">
              {new Date(message.created_at).toLocaleString()}
              {message.id === lastMine?.id && message.seen ? " · Seen" : ""}
            </p>
          </li>
        ))}
      </ul>
      {closed ? (
        <p className="mt-3 text-base text-muted">
          This conversation is closed. Need help? Visit <Link href="/help" className="font-semibold text-brand">Help</Link> or{" "}
          <Link href={reportHref} className="font-semibold text-brand">Report a problem</Link>
        </p>
      ) : (
        <form onSubmit={(event) => void send(event)} className="mt-3 grid gap-2">
          {showQuickReplies ? (
            <div className="flex flex-wrap gap-2">
              {quickReplies.map((reply) => (
                <button
                  key={reply}
                  type="button"
                  onClick={() => setText(reply)}
                  className="inline-flex min-h-12 items-center rounded-full border border-line bg-paper-raised px-4 text-sm font-semibold"
                >
                  {reply}
                </button>
              ))}
            </div>
          ) : null}
          <label className="text-base font-semibold text-ink" htmlFor={`message-${threadId}`}>
            Message
            <textarea
              id={`message-${threadId}`}
              value={text}
              onChange={(event) => setText(event.target.value)}
              rows={3}
              maxLength={1000}
              className="mt-2 min-h-24 w-full rounded-2xl border border-line bg-paper-raised px-4 py-3 text-base font-normal"
            />
          </label>
          {warning ? (
            <p role="alert" className="text-base text-danger">
              Remove the phone number or email before sending. Pickuply keeps contact details off the chat.
            </p>
          ) : null}
          <label className="text-base font-semibold text-ink" htmlFor={`file-${threadId}`}>
            Photo or PDF
            <input
              id={`file-${threadId}`}
              type="file"
              accept="image/jpeg,image/png,image/webp,application/pdf"
              className="mt-2 block w-full text-base font-normal"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void addFile(file);
                event.target.value = "";
              }}
            />
          </label>
          {error ? (
            <p role="alert" className="text-base text-danger">
              {error}
            </p>
          ) : null}
          <button
            type="submit"
            disabled={warning || text.trim().length === 0}
            className="inline-flex min-h-12 items-center justify-center rounded-full bg-brand px-6 font-semibold text-white disabled:opacity-60"
          >
            Send
          </button>
        </form>
      )}
    </section>
  );
}
