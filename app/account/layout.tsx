import type { ReactNode } from "react";
import { noIndex } from "@/lib/seo";

export const metadata = noIndex;

export default function AccountLayout({ children }: { children: ReactNode }) {
  return children;
}
