export type RoleBadge = "DRIVER" | "CUSTOMER" | "ADMIN";

/** The badge for the account someone is using now. It follows the server home, not a role sent by the browser. */
export function roleBadgeForHome(homeHref: string): RoleBadge | null {
  if (homeHref === "/driver") return "DRIVER";
  if (homeHref === "/account") return "CUSTOMER";
  if (homeHref === "/admin") return "ADMIN";
  return null;
}
