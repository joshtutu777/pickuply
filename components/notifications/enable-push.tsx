"use client";

import { useState } from "react";

function keyBytes(value: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index);
  return bytes;
}

export function EnablePush({ publicKey }: { publicKey: string | null }) {
  const [message, setMessage] = useState<string | null>(null);

  async function enable() {
    if (!publicKey || !("serviceWorker" in navigator) || !("PushManager" in window)) {
      setMessage("This browser cannot show alerts yet.");
      return;
    }
    const registration = await navigator.serviceWorker.register("/sw.js");
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      setMessage("Alerts stay off until you allow them.");
      return;
    }
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: keyBytes(publicKey),
    });
    const response = await fetch("/api/push/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(subscription),
    });
    setMessage(response.ok ? "Alerts are on for this device." : "We could not save this device.");
  }

  return (
    <div className="mt-4">
      <button
        type="button"
        onClick={() => void enable()}
        disabled={!publicKey}
        className="inline-flex min-h-12 items-center justify-center rounded-full bg-brand px-6 font-semibold text-white disabled:opacity-60"
      >
        Turn on alerts
      </button>
      {message ? <p className="mt-2 text-base text-muted">{message}</p> : null}
    </div>
  );
}
