"use client";

import { useEffect, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { scrollIntent } from "@/lib/ui/scroll-app";

function scrollToHash(hash: string) {
  const target = document.getElementById(hash);
  target?.scrollIntoView({ block: "start" });
}

function scrollToTop() {
  const root = document.querySelector("[data-app-scroll]");
  if (root instanceof HTMLElement) root.scrollTop = 0;
  window.scrollTo(0, 0);
}

/** The app scrolls inside [data-app-scroll] on a phone. Reset that panel when a new screen opens. */
export function ScrollRestore() {
  const pathname = usePathname();
  const search = useSearchParams();
  const popped = useRef(false);

  useEffect(() => {
    const mark = () => {
      popped.current = true;
    };
    window.addEventListener("popstate", mark);
    return () => window.removeEventListener("popstate", mark);
  }, []);

  useEffect(() => {
    const hash = window.location.hash.replace("#", "");
    const intent = scrollIntent({ hash, popped: popped.current });
    popped.current = false;
    if (intent === "restore") return;
    if (intent === "hash") {
      scrollToHash(hash);
      return;
    }
    scrollToTop();
  }, [pathname, search]);

  return null;
}

export function ScrollOnValue({ value }: { value: string }) {
  const last = useRef(value);
  useEffect(() => {
    if (last.current === value) return;
    last.current = value;
    scrollToTop();
  }, [value]);
  return null;
}
