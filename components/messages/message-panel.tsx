"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent, type KeyboardEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { UploadPicker } from "@/components/upload-picker";
import { containsContact } from "@/lib/messages/contact";
import { messageClock, messageDay } from "@/lib/messages/preview";
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

let messageClockNow = "";

function messageClockSnapshot(): string {
  if (messageClockNow.length === 0) messageClockNow = new Date().toISOString();
  return messageClockNow;
}

function newKey(): string {
  return crypto.randomUUID();
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
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [offline, setOffline] = useState(
    () => typeof navigator !== "undefined" && navigator.onLine === false,
  );
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const countRef = useRef(initial.length);
  const listRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const keyRef = useRef(newKey());
  const warning = containsContact(text);
  const nowIso = useSyncExternalStore(emptySubscribe, messageClockSnapshot, () => "");
  const closed = Boolean(closesAt && nowIso.length > 0 && closesAt <= nowIso);
  const lastMine = [...messages].reverse().find((message) => message.mine);

  function nearBottom(): boolean {
    const list = listRef.current;
    if (!list) return true;
    return list.scrollHeight - list.scrollTop - list.clientHeight < 80;
  }

  function scrollToEnd() {
    const list = listRef.current;
    if (!list) return;
    list.scrollTop = list.scrollHeight;
  }

  async function refresh(mark: boolean) {
    const response = await fetch(`/api/messages/${threadId}${mark ? "?mark=1" : ""}`);
    if (!response.ok) return;
    const payload = (await response.json()) as { messages?: ChatMessage[] };
    if (!payload.messages) return;
    const next = payload.messages;
    const incoming = next.length > countRef.current && next.at(-1)?.mine === false;
    countRef.current = next.length;
    setMessages(next);
    if (stickRef.current || next.at(-1)?.mine) scrollToEnd();
    if (incoming) router.refresh();
  }

  async function addFile(file: File) {
    const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
    if (!["jpg", "jpeg", "png", "webp", "pdf"].includes(extension) || file.size > 5_000_000) {
      setError("Choose a photo or PDF under 5 MB.");
      return;
    }
    setUploading(true);
    setError(null);
    try {
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
      await refresh(document.visibilityState === "visible");
      router.refresh();
    } finally {
      setUploading(false);
    }
  }

  useEffect(() => {
    const online = () => setOffline(false);
    const gone = () => setOffline(true);
    window.addEventListener("online", online);
    window.addEventListener("offline", gone);
    const supabase = createClient();
    const channel = supabase
      .channel(`thread-${threadId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `thread_id=eq.${threadId}` },
        () => {
          void refresh(document.visibilityState === "visible");
        },
      )
      .subscribe();
    const pull = () => {
      void refresh(document.visibilityState === "visible");
    };
    const first = window.setTimeout(pull, 0);
    const timer = window.setInterval(pull, 15000);
    return () => {
      window.removeEventListener("online", online);
      window.removeEventListener("offline", gone);
      window.clearTimeout(first);
      window.clearInterval(timer);
      void supabase.removeChannel(channel);
    };
    // The thread id is the subscription boundary. Refresh reads the latest messages.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId]);

  async function deliver(clientKey: string) {
    const response = await fetch(`/api/messages/${threadId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: text, clientKey }),
    });
    if (!response.ok) {
      setFailedKey(clientKey);
      setError("That message could not be sent.");
      return;
    }
    const payload = (await response.json()) as { messages?: ChatMessage[] };
    if (payload.messages) setMessages(payload.messages);
    setText("");
    setFailedKey(null);
    setError(null);
    keyRef.current = newKey();
    stickRef.current = true;
    scrollToEnd();
    router.refresh();
  }

  async function send(event?: FormEvent) {
    event?.preventDefault();
    if (warning || closed || text.trim().length === 0 || sending) return;
    setSending(true);
    setError(null);
    try {
      await deliver(failedKey ?? keyRef.current);
    } finally {
      setSending(false);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void send();
    }
  }

  return (
    <section className="mt-4" aria-label="Messages">
      <h2 className="text-lg font-semibold text-ink">Messages</h2>
      {offline ? (
        <p role="status" className="mt-2 text-base text-danger">
          You are offline. The message stays here until you can send it.
        </p>
      ) : null}
      {messages.length === 0 ? <p className="mt-2 text-base text-muted">No messages yet. Say hello when you are ready.</p> : null}
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
      <div
        ref={listRef}
        onScroll={() => {
          stickRef.current = nearBottom();
        }}
        className="mt-3 grid max-h-96 gap-2 overflow-y-auto"
        aria-live="polite"
      >
        {messages.map((message, index) => {
          const day = messageDay(message.created_at);
          const previous = index > 0 ? messageDay(messages[index - 1].created_at) : "";
          return (
            <div key={message.id}>
              {day !== previous ? <p className="py-2 text-center text-sm font-semibold text-muted">{day}</p> : null}
              <div className={message.mine ? "flex justify-end" : "flex justify-start"}>
                <div
                  className={
                    message.mine
                      ? "max-w-[85%] rounded-2xl bg-brand px-4 py-3 text-white"
                      : "max-w-[85%] rounded-2xl bg-paper-raised px-4 py-3 text-ink ring-1 ring-line"
                  }
                >
                  <p className={`text-sm font-semibold ${message.mine ? "text-white/80" : "text-muted"}`}>
                    {message.mine ? "You" : message.sender_name}
                  </p>
                  <p className="whitespace-pre-wrap text-base">{message.body}</p>
                  {message.action_href && /^\/jobs\/[0-9a-fA-F-]{36}\/edit$/.test(message.action_href) ? (
                    <Link
                      href={message.action_href}
                      className="mt-3 inline-flex min-h-12 items-center justify-center rounded-full bg-white px-6 font-semibold text-ink"
                    >
                      Add details
                    </Link>
                  ) : null}
                  <p className={`text-sm ${message.mine ? "text-white/80" : "text-muted"}`}>
                    <time dateTime={message.created_at}>{messageClock(message.created_at)}</time>
                    {message.id === lastMine?.id && message.seen ? " · Seen" : ""}
                  </p>
                </div>
              </div>
            </div>
          );
        })}
      </div>
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
              onKeyDown={onKeyDown}
              rows={3}
              maxLength={1000}
              enterKeyHint="send"
              className="mt-2 min-h-24 w-full rounded-2xl border border-line bg-paper-raised px-4 py-3 text-base font-normal"
            />
          </label>
          <p className="text-sm text-muted">Press Ctrl+Enter to send.</p>
          {warning ? (
            <p role="alert" className="text-base text-danger">
              Remove the phone number or email before sending. Pickuply keeps contact details off the chat.
            </p>
          ) : null}
          <UploadPicker
            id={`file-${threadId}`}
            accept="image/jpeg,image/png,image/webp,application/pdf"
            label="Add a photo or PDF"
            kinds="JPG, PNG, WEBP, or PDF under 5 MB"
            clearAfter
            busy={uploading}
            onChange={(files) => {
              const file = files?.[0];
              if (file) void addFile(file);
            }}
          />
          {error ? (
            <p role="alert" className="text-base text-danger">
              {error}
            </p>
          ) : null}
          {failedKey ? (
            <button
              type="button"
              onClick={() => void send()}
              disabled={sending}
              className="inline-flex min-h-12 items-center justify-center rounded-full border border-line bg-paper-raised px-6 font-semibold text-ink"
            >
              Retry
            </button>
          ) : null}
          <button
            type="submit"
            disabled={warning || text.trim().length === 0 || sending || offline}
            aria-busy={sending}
            className="inline-flex min-h-12 items-center justify-center rounded-full bg-brand px-6 font-semibold text-white disabled:opacity-60"
          >
            {sending ? "Sending..." : "Send"}
          </button>
        </form>
      )}
    </section>
  );
}
