"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { alertAllowed, claimAlert, shouldPlaySound, type AlertPrefs } from "@/lib/notifications/live-alert";
import { readAlertPrefs } from "@/lib/notifications/alert-prefs";

type AlertRow = { id: string; kind: string; title: string; body: string; href: string };

const seenKey = "pickuply-alert-seen";

function readSeen(): Set<string> {
  try {
    const raw = localStorage.getItem(seenKey);
    const ids = raw ? (JSON.parse(raw) as unknown) : [];
    return new Set(Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : []);
  } catch {
    return new Set();
  }
}

function writeSeen(seen: Set<string>) {
  localStorage.setItem(seenKey, JSON.stringify([...seen].slice(-200)));
}

function playChime() {
  const Context = window.AudioContext ?? window.webkitAudioContext;
  if (!Context) return;
  try {
  const audio = new Context();
  const now = audio.currentTime;
  const tone = (frequency: number, at: number) => {
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(0.04, at + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.18);
    oscillator.connect(gain);
    gain.connect(audio.destination);
    oscillator.start(at);
    oscillator.stop(at + 0.2);
  };
  void audio.resume().then(() => {
    tone(880, now);
    tone(1175, now + 0.12);
    window.setTimeout(() => void audio.close(), 600);
  }).catch(() => {
    void audio.close();
  });
  } catch {
    return;
  }
}

export function LiveAlerts() {
  const router = useRouter();
  const [toast, setToast] = useState<AlertRow | null>(null);

  useEffect(() => {
    let ready = false;
    const seen = readSeen();
    const supabase = createClient();

    async function look() {
      const prefs: AlertPrefs = readAlertPrefs();
      const { data } = await supabase
        .from("notifications")
        .select("id, kind, title, body, href")
        .order("created_at", { ascending: false })
        .limit(20);
      const rows = (data ?? []) as AlertRow[];
      if (!ready) {
        for (const row of rows) seen.add(row.id);
        writeSeen(seen);
        ready = true;
        return;
      }
      const stored = readSeen();
      for (const id of stored) seen.add(id);
      let fresh = false;
      for (const row of rows) {
        if (!claimAlert(row.id, seen)) continue;
        fresh = true;
        if (!alertAllowed(row.kind, prefs)) continue;
        setToast(row);
        const visible = document.visibilityState === "visible";
        if (shouldPlaySound({ allowed: true, soundOn: prefs.sound, visible })) playChime();
        if (!visible && typeof Notification !== "undefined" && Notification.permission === "granted") {
          try {
            new Notification(row.title, { body: row.body, tag: row.id });
          } catch {
            setToast(row);
          }
        }
      }
      if (fresh) {
        writeSeen(seen);
        router.refresh();
      }
    }

    const start = window.setTimeout(() => void look(), 0);
    const poll = window.setInterval(() => {
      if (document.visibilityState === "visible") void look();
    }, 25000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void look();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    const channel = supabase
      .channel("live-alerts")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications" }, () => {
        void look();
      })
      .subscribe();
    return () => {
      window.clearTimeout(start);
      window.clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      void supabase.removeChannel(channel);
    };
  }, [router]);

  if (!toast) return null;
  return (
    <div role="status" className="fixed top-3 right-3 left-3 z-50 mx-auto max-w-xl rounded-2xl bg-ink p-4 text-white shadow-lg">
      <p className="font-semibold">{toast.title}</p>
      <p className="mt-1 text-sm">{toast.body}</p>
      <div className="mt-3 flex gap-3">
        <a href={toast.href} className="inline-flex min-h-12 items-center font-semibold">
          Open
        </a>
        <button type="button" onClick={() => setToast(null)} className="inline-flex min-h-12 items-center font-semibold">
          Close
        </button>
      </div>
    </div>
  );
}

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}
