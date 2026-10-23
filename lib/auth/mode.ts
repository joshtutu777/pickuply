import { continueDestination, roleHome, type Role } from "@/lib/auth/access";

export type AppMode = "customer" | "driver";

/**
 * Where to send someone after login. The cookie is only a preference.
 * An explicit return path wins. Admin stays in admin. A driver preference
 * with no driver row goes back to the customer account.
 */
export function preferredHome(input: {
  role: Role;
  mode: AppMode | null;
  hasDriver: boolean;
  next: string | null;
  intent: string | null;
}): string {
  if (input.next) return continueDestination(input.role, input.next, input.intent);
  if (input.role === "admin") return "/admin";
  if (input.mode === "driver") {
    if (input.role === "driver" || input.hasDriver) return "/driver";
    return "/account";
  }
  if (input.mode === "customer") return "/account";
  return roleHome(input.role);
}
