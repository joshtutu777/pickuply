import type { ReactNode } from "react";
import { noIndex } from "@/lib/seo";

export const metadata = noIndex;

export default function HelpLayout({ children }: { children: ReactNode }) {
  return children;
}
