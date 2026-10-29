"use client";

import { useState } from "react";

const shareUrl = "https://pickuplyapp.com";

export function SharePickuply({ className }: { className: string }) {
  const [note, setNote] = useState("");

  async function share() {
    setNote("");
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title: "Pickuply", url: shareUrl });
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(shareUrl);
      setNote("Link copied");
    } catch {
      setNote(shareUrl);
    }
  }

  return (
    <span className="block">
      <button type="button" onClick={() => void share()} className={className}>
        Share Pickuply
      </button>
      {note ? <span className="mt-1 block text-sm text-muted">{note}</span> : null}
    </span>
  );
}
