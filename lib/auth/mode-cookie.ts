import "server-only";

import { cookies } from "next/headers";
import type { AppMode } from "@/lib/auth/mode";

const cookieName = "pickuply.mode";

export async function readMode(): Promise<AppMode | null> {
  const jar = await cookies();
  const value = jar.get(cookieName)?.value;
  if (value === "customer" || value === "driver") return value;
  return null;
}

export async function writeMode(mode: AppMode): Promise<void> {
  const jar = await cookies();
  jar.set(cookieName, mode, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
}
