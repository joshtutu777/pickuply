import type { Role } from "@/lib/auth/access";
import { validateNamePart } from "@/lib/auth/name";

export type HomeAccount =
  | { kind: "signed-out" }
  | { kind: "finish-profile"; firstName: string | null }
  | { kind: "customer"; firstName: string | null }
  | { kind: "driver"; firstName: string | null }
  | { kind: "admin"; firstName: string | null };

function shownName(value: string | null): string | null {
  return validateNamePart(value ?? "");
}

/**
 * What the public homepage shows for the current session.
 * A customer without both names is not treated as registered.
 * Drivers and admins keep their own homes.
 */
export function homeAccount(input: {
  signedIn: boolean;
  role: Role | null;
  firstName: string | null;
  registrationComplete: boolean;
}): HomeAccount {
  if (!input.signedIn) return { kind: "signed-out" };
  const firstName = shownName(input.firstName);
  if (input.role === "driver") return { kind: "driver", firstName };
  if (input.role === "admin") return { kind: "admin", firstName };
  if (input.role !== "customer" || !input.registrationComplete) {
    return { kind: "finish-profile", firstName };
  }
  return { kind: "customer", firstName };
}
