"use client";

import { useEffect, useState } from "react";
import { unreadLabel } from "@/lib/messages/preview";

export function MessageDock({
  label,
  unread,
  href,
}: {
  label: string;
  unread: number;
  href: string;
}) {
  const [away, setAway] = useState(false);

  useEffect(() => {
    const target = document.getElementById("message-launch");
    if (!target) return;
    const observer = new IntersectionObserver(
      ([entry]) => setAway(!entry?.isIntersecting),
      { threshold: 0.5 },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, []);

  if (!away) return null;

  return (
    <a
      href={href}
      className="fixed inset-x-4 bottom-20 z-30 mx-auto flex min-h-12 max-w-xl items-center justify-between gap-3 rounded-full bg-ink px-4 text-white shadow-lg md:bottom-4"
    >
      <span className="font-semibold">{label}</span>
      {unread > 0 ? (
        <span className="rounded-full bg-white px-2 py-1 text-sm font-semibold text-ink">{unreadLabel(unread)}</span>
      ) : (
        <span className="text-sm">Open</span>
      )}
    </a>
  );
}
