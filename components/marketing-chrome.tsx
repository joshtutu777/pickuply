"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/** Hides the app header or footer on the public landing page, which has its own. */
export function MarketingSlot({ children }: { children: ReactNode }) {
  if (usePathname() === "/") return null;
  return children;
}
