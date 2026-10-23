"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export async function dismissOnlinePrompt() {
  const jar = await cookies();
  jar.set("pickuply.online-prompt", "dismissed", {
    path: "/",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 365,
  });
  redirect("/driver");
}
