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
import { displayFullName } from "@/lib/auth/name";
import { createClient } from "@/lib/supabase/server";

const AUTH_TIMEOUT_MS = 4000;

export type OptionalSession = {
  userId: string;
  role: Role | null;
  fullName: string | null;
  firstName: string | null;
  lastName: string | null;
  nameOnFile: string | null;
  registrationComplete: boolean;
  deleted: boolean;
};

export type SignedInSession = {
  userId: string;
  role: Role;
  fullName: string | null;
  firstName: string | null;
  lastName: string | null;
  nameOnFile: string | null;
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
          supabase
            .from("profiles")
            .select("role, full_name, first_name, last_name, registration_completed_at, deleted_at")
            .eq("id", userId)
            .maybeSingle(),
        ),
      );
      if (profileError || !profile) {
        return {
          userId,
          role: null,
          fullName: null,
          firstName: null,
          lastName: null,
          nameOnFile: null,
          registrationComplete: false,
          deleted: false,
        };
      }
      const role = typeof profile.role === "string" && isRole(profile.role) ? profile.role : null;
      const nameOnFile = typeof profile.full_name === "string" ? profile.full_name : null;
      const firstName = typeof profile.first_name === "string" ? profile.first_name : null;
      const lastName = typeof profile.last_name === "string" ? profile.last_name : null;
      const fullName = displayFullName({ firstName, lastName, fullName: nameOnFile });
      return {
        userId,
        role,
        fullName,
        firstName,
        lastName,
        nameOnFile,
        registrationComplete: profile.registration_completed_at != null,
        deleted: profile.deleted_at != null,
      };
    } catch {
      return {
        userId,
        role: null,
        fullName: null,
        firstName: null,
        lastName: null,
        nameOnFile: null,
        registrationComplete: false,
        deleted: false,
      };
    }
  } catch {
    return null;
  }
}

export function stateFromSession(session: OptionalSession | null): AccessState {
  if (!session || session.deleted) {
    return accessStateFromProfile({ signedIn: false, role: null, fullName: null });
  }
  return accessStateFromProfile({
    signedIn: true,
    role: session.role,
    fullName: session.nameOnFile,
    firstName: session.firstName,
    lastName: session.lastName,
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
    firstName: session.firstName,
    lastName: session.lastName,
    nameOnFile: session.nameOnFile,
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
