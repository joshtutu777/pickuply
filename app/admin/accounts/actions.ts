"use server";

import { connection } from "next/server";
import { redirect } from "next/navigation";
import { parseNyDateTime } from "@/lib/account/restriction";
import { createClient } from "@/lib/supabase/server";

function returnTo(value: FormDataEntryValue | null): string {
  const path = String(value ?? "");
  if (!path.startsWith("/admin/") || path.startsWith("//") || path.includes("\\") || path.includes("?")) {
    return "/admin/accounts";
  }
  return path;
}

function bounce(path: string, error: string): never {
  const joiner = path.includes("?") ? "&" : "?";
  redirect(`${path}${joiner}error=${encodeURIComponent(error)}`);
}

export async function suspendAccount(formData: FormData) {
  await connection();
  const path = returnTo(formData.get("returnTo"));
  const target = String(formData.get("profileId") ?? "");
  const kind = String(formData.get("kind") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  const note = String(formData.get("note") ?? "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(target)) bounce(path, "Choose an account.");
  if (kind !== "temporary" && kind !== "indefinite") bounce(path, "Choose how long the restriction lasts.");
  if (reason.length < 3) bounce(path, "A reason is required.");
  const expires = kind === "temporary" ? parseNyDateTime(String(formData.get("expiresAt") ?? "")) : null;
  if (kind === "temporary" && !expires) bounce(path, "Choose when the temporary restriction ends. Use Eastern time.");
  const supabase = await createClient();
  const { error } = await supabase.rpc("suspend_account", {
    target,
    kind,
    reason,
    expires_at: expires,
    note: note || null,
  });
  if (error) bounce(path, error.message);
  redirect(`${path}?saved=suspended`);
}

export async function reinstateAccount(formData: FormData) {
  await connection();
  const path = returnTo(formData.get("returnTo"));
  const target = String(formData.get("profileId") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(target)) bounce(path, "Choose an account.");
  const supabase = await createClient();
  const { error } = await supabase.rpc("reinstate_account", { target });
  if (error) bounce(path, error.message);
  redirect(`${path}?saved=reinstated`);
}

export async function completeDeletion(formData: FormData) {
  await connection();
  const target = String(formData.get("profileId") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(target)) bounce("/admin/accounts", "Choose an account.");
  const supabase = await createClient();
  const { error } = await supabase.rpc("complete_account_deletion", { target });
  if (error) bounce("/admin/accounts", error.message);
  redirect("/admin/accounts?saved=deleted");
}

export async function deferDeletion(formData: FormData) {
  await connection();
  const target = String(formData.get("profileId") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(target)) bounce("/admin/accounts", "Choose an account.");
  if (reason.length < 3) bounce("/admin/accounts", "A reason is required.");
  const supabase = await createClient();
  const { error } = await supabase.rpc("defer_account_deletion", { target, reason });
  if (error) bounce("/admin/accounts", error.message);
  redirect("/admin/accounts?saved=deferred");
}
