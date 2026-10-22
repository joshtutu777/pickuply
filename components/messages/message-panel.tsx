"use client";

import { useEffect, useState, useSyncExternalStore, type FormEvent } from "react";
import { containsContact } from "@/lib/messages/contact";

export type ChatMessage = {
  id: string;
  body: string;
  created_at: string;
  mine: boolean;
  sender_name: string;
};

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
}: {
  threadId: string;
  initial: ChatMessage[];
  closesAt: string | null;
  showQuickReplies?: boolean;
}) {
  const [messages, setMessages] = useState(initial);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const warning = containsContact(text);
  const nowIso = useSyncExternalStore(emptySubscribe, messageClockSnapshot, () => "");
  const closed = Boolean(closesAt && nowIso.length > 0 && closesAt <= nowIso);

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
      <ul className="mt-3 grid gap-2">
        {messages.map((message) => (
          <li key={message.id} className="rounded-2xl bg-paper-raised px-4 py-3 ring-1 ring-line">
            <p className="text-sm font-semibold text-muted">{message.sender_name}</p>
            <p className="text-base text-ink">{message.body}</p>
            <p className="text-sm text-muted">{new Date(message.created_at).toLocaleString()}</p>
          </li>
        ))}
      </ul>
      {closed ? (
        <p className="mt-3 text-base text-muted">This conversation is closed.</p>
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
