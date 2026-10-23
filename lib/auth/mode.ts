import { continueDestination, type Role } from "@/lib/auth/access";

export type AppMode = "customer" | "driver";

/**
 * The home for the mode someone is in now. Switch to customer is the only
 * choice that keeps a driver on the customer account. With no choice, a
 * driver record opens /driver.
 */
export function homeFor(input: {
  role: Role | null;
  mode: AppMode | null;
  hasDriver: boolean;
}): "/account" | "/driver" | "/admin" {
  if (input.mode === "customer") return "/account";
  if (input.role === "admin" && input.mode !== "driver") return "/admin";
  if (input.hasDriver || input.role === "driver") return "/driver";
  return "/account";
}

function isOnboarding(next: string): boolean {
  const path = next.split(/[?#]/)[0]?.replace(/\/+$/, "") || next;
  return path === "/driver/onboarding" || path.startsWith("/driver/onboarding/");
}

/**
 * Where to send someone after login. The cookie is only a preference.
 * An explicit return path wins, except Quick Apply, which existing drivers skip.
 * Admin stays in admin. A driver preference with no driver row goes back to the customer account.
 */
export function preferredHome(input: {
  role: Role;
  mode: AppMode | null;
  hasDriver: boolean;
  next: string | null;
  intent: string | null;
}): string {
  if (input.next && isOnboarding(input.next) && (input.hasDriver || input.role === "driver") && input.role !== "admin") {
    return "/driver";
  }
  if (input.next) return continueDestination(input.role, input.next, input.intent);
  if (input.role === "admin") return "/admin";
  return homeFor(input);
}
