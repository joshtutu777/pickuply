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
  const hours: Record<string, number> = { "hours-24": 24, "days-3": 72, "days-7": 168, "days-30": 720 };
  let storedKind: "temporary" | "indefinite";
  let expires: string | null = null;
  if (kind === "indefinite") storedKind = "indefinite";
  else if (hours[kind]) {
    storedKind = "temporary";
    expires = new Date(Date.now() + hours[kind] * 60 * 60 * 1000).toISOString();
  } else if (kind === "custom") {
    storedKind = "temporary";
    expires = parseNyDateTime(String(formData.get("expiresAt") ?? ""));
    if (!expires) bounce(path, "Choose when the temporary restriction ends. Use Eastern time.");
  } else bounce(path, "Choose how long the restriction lasts.");
  if (reason.length < 3) bounce(path, "A reason is required.");
  const supabase = await createClient();
  const { error } = await supabase.rpc("suspend_account", {
    target,
    kind: storedKind,
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

function deletionError(message: string): string {
  if (message.includes("still has obligations")) {
    return "This account still has an open job or unpaid money. Finish that before deleting it.";
  }
  if (message.includes("last active admin")) return "The last admin account cannot be deleted.";
  if (message.includes("own account")) return "You cannot delete the account you are signed in with.";
  if (message.includes("not found")) return "That account was not found.";
  if (message.includes("only an admin")) return "Only an admin can delete an account.";
  return "The account could not be deleted.";
}

export async function releaseAccount(formData: FormData) {
  await connection();
  const path = returnTo(formData.get("returnTo"));
  const target = String(formData.get("profileId") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(target)) bounce(path, "Choose an account.");
  if (formData.get("confirm") !== "on") {
    bounce(path, "Confirm that this phone can sign up again.");
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_release_account", { target });
  if (error) bounce(path, deletionError(error.message));
  redirect(`${path}?saved=deleted`);
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
