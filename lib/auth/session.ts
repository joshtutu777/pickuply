import "server-only";

import { connection } from "next/server";
import { redirect } from "next/navigation";
import {
  accessStateFromProfile,
  decideAccess,
  isRole,
  roleHome,
  type AccessState,
  type Role,
} from "@/lib/auth/access";
import { createClient } from "@/lib/supabase/server";

const AUTH_TIMEOUT_MS = 4000;

export type OptionalSession = {
  userId: string;
  role: Role | null;
  fullName: string | null;
};

export type SignedInSession = {
  userId: string;
  role: Role;
  fullName: string | null;
};

/**
 * The signed-in user and their profile row, or null when nobody is signed in
 * or the public Supabase settings are missing. Role is read from profiles only.
 */
export async function getOptionalSession(): Promise<OptionalSession | null> {
  await connection();

  let supabase: Awaited<ReturnType<typeof createClient>>;
  try {
    supabase = await createClient();
  } catch {
    return null;
  }

  try {
    const { data, error } = await withTimeout(supabase.auth.getUser());
    if (error || !data.user) return null;
    const userId = data.user.id;

    try {
      const { data: profile, error: profileError } = await withTimeout(
        Promise.resolve(
          supabase.from("profiles").select("role, full_name").eq("id", userId).maybeSingle(),
        ),
      );
      if (profileError || !profile) {
        return { userId, role: null, fullName: null };
      }
      const role = typeof profile.role === "string" && isRole(profile.role) ? profile.role : null;
      const fullName = typeof profile.full_name === "string" ? profile.full_name : null;
      return { userId, role, fullName };
    } catch {
      return { userId, role: null, fullName: null };
    }
  } catch {
    return null;
  }
}

export function stateFromSession(session: OptionalSession | null): AccessState {
  if (!session) {
    return accessStateFromProfile({ signedIn: false, role: null, fullName: null });
  }
  return accessStateFromProfile({
    signedIn: true,
    role: session.role,
    fullName: session.fullName,
  });
}

export async function requireSignedIn(pathname: string, search = ""): Promise<SignedInSession> {
  const session = await getOptionalSession();
  const decision = decideAccess({ pathname, search, state: stateFromSession(session) });
  if (decision.type === "redirect") redirect(decision.location);
  if (!session?.role) redirect("/login?error=profile");
  return {
    userId: session.userId,
    role: session.role,
    fullName: session.fullName?.trim() ? session.fullName.trim() : null,
  };
}

export async function requireAdmin(pathname = "/admin"): Promise<SignedInSession> {
  const session = await requireSignedIn(pathname);
  if (session.role !== "admin") redirect(`${roleHome(session.role)}?error=forbidden`);
  return session;
}

function withTimeout<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("timeout")), AUTH_TIMEOUT_MS);
  });
  void work.then(
    () => undefined,
    () => undefined,
  );
  return Promise.race([work, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}
