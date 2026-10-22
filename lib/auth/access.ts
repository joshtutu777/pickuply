import { safeReturnPath } from "./safe-return-path";

export const ACCESS_DENIED_MESSAGE = "You don't have access to that page.";

export type Role = "customer" | "driver" | "admin";

export type AccessState =
  | { status: "anonymous" }
  | { status: "missing-profile" }
  | { status: "needs-name"; role: Role }
  | { status: "ready"; role: Role; fullName: string };

export type AccessDecision = { type: "allow" } | { type: "redirect"; location: string };

const ROLES = new Set<Role>(["customer", "driver", "admin"]);

export function isRole(value: string): value is Role {
  return ROLES.has(value as Role);
}

export function roleHome(role: Role): "/account" | "/driver" | "/admin" {
  if (role === "admin") return "/admin";
  if (role === "driver") return "/driver";
  return "/account";
}

export function accessStateFromProfile(input: {
  signedIn: boolean;
  role: string | null;
  fullName: string | null;
}): AccessState {
  if (!input.signedIn) return { status: "anonymous" };
  if (!input.role || !isRole(input.role)) return { status: "missing-profile" };
  const fullName = input.fullName?.trim() ?? "";
  if (!fullName) return { status: "needs-name", role: input.role };
  return { status: "ready", role: input.role, fullName };
}

/** A return path we are willing to send someone to after sign-in. Auth screens are not destinations. */
export function safeNextParam(value: string | null | undefined): string | null {
  const safe = safeReturnPath(value);
  if (!safe) return null;
  const path = stripTrailingSlash(pathOnly(safe));
  if (path === "/login" || path === "/auth/continue" || matches(path, "/login/name")) return null;
  return safe;
}

export function decideAccess(input: {
  pathname: string;
  search?: string;
  state: AccessState;
}): AccessDecision {
  const pathname = stripTrailingSlash(input.pathname);
  const search = input.search ?? "";
  if (!pathname.startsWith("/") || pathname.startsWith("//") || hasUnsafePath(pathname)) {
    return { type: "allow" };
  }

  if (pathname === "/auth/continue") {
    return continueRouteDecision(search, input.state);
  }

  if (input.state.status === "anonymous") {
    if (!isProtected(pathname)) return { type: "allow" };
    return redirect(withNext("/login", nextFromHere(pathname, search)));
  }

  if (input.state.status === "missing-profile") {
    if (pathname === "/login" || !isProtected(pathname)) return { type: "allow" };
    return redirect("/login?error=profile");
  }

  if (input.state.status === "needs-name") {
    if (matches(pathname, "/login/name")) return { type: "allow" };
    if (pathname === "/login") return redirect(withNext("/login/name", safeNextParam(rawNext(search))));
    if (isProtected(pathname)) return redirect(withNext("/login/name", nextFromHere(pathname, search)));
    return { type: "allow" };
  }

  if (pathname === "/login" || matches(pathname, "/login/name")) {
    return redirect(withNext("/auth/continue", safeNextParam(rawNext(search))));
  }

  return roleGate(pathname, input.state.role);
}

export function continueDestination(role: Role, next: string | null | undefined): string {
  const safe = safeNextParam(next);
  if (!safe) return roleHome(role);
  const path = stripTrailingSlash(pathOnly(safe));
  const decision = roleGate(path, role);
  if (decision.type === "redirect") return decision.location;
  return safe;
}

function continueRouteDecision(search: string, state: AccessState): AccessDecision {
  const next = safeNextParam(rawNext(search));
  if (state.status === "anonymous") return redirect(withNext("/login", next));
  if (state.status === "missing-profile") return redirect("/login?error=profile");
  if (state.status === "needs-name") return redirect(withNext("/login/name", next));
  return { type: "allow" };
}

function roleGate(pathname: string, role: Role): AccessDecision {
  if (matches(pathname, "/admin") && role !== "admin") {
    return redirect(`${roleHome(role)}?error=forbidden`);
  }
  if (matches(pathname, "/driver") && !driverOpenToAnyRole(pathname) && role !== "driver") {
    return redirect(`${roleHome(role)}?error=forbidden`);
  }
  return { type: "allow" };
}

function nextFromHere(pathname: string, search: string): string | null {
  if (matches(pathname, "/login/name")) return safeNextParam(rawNext(search));
  return safeNextParam(currentLocation(pathname, search));
}

function currentLocation(pathname: string, search: string): string | null {
  const query = search ? (search.startsWith("?") ? search : `?${search}`) : "";
  return safeReturnPath(`${pathname}${query}`) ?? safeReturnPath(pathname);
}

function rawNext(search: string): string | null {
  if (!search) return null;
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  return params.get("next");
}

function withNext(pathname: string, next: string | null): string {
  if (!next) return pathname;
  return `${pathname}?${new URLSearchParams({ next }).toString()}`;
}

function redirect(location: string): AccessDecision {
  return { type: "redirect", location };
}

function isProtected(pathname: string): boolean {
  return (
    matches(pathname, "/account") ||
    matches(pathname, "/driver") ||
    matches(pathname, "/admin") ||
    matches(pathname, "/login/name")
  );
}

function driverOpenToAnyRole(pathname: string): boolean {
  return (
    pathname === "/driver" ||
    matches(pathname, "/driver/onboarding") ||
    matches(pathname, "/driver/training")
  );
}

function matches(pathname: string, base: string): boolean {
  return pathname === base || pathname.startsWith(`${base}/`);
}

function pathOnly(value: string): string {
  const end = value.search(/[?#]/);
  return end === -1 ? value : value.slice(0, end);
}

function stripTrailingSlash(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith("/")) {
    return stripTrailingSlash(pathname.slice(0, -1));
  }
  return pathname;
}

function hasUnsafePath(pathname: string): boolean {
  return pathname.includes("\\") || pathname.includes(":") || pathname.includes("@");
}
