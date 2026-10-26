export type AppNavIcon = "home" | "jobs" | "messages" | "alerts" | "profile";

export type AppNavItem = {
  href: string;
  label: string;
  icon: AppNavIcon;
};

export const customerNav: AppNavItem[] = [
  { href: "/account", label: "Home", icon: "home" },
  { href: "/account/jobs", label: "Requests", icon: "jobs" },
  { href: "/account/messages", label: "Messages", icon: "messages" },
  { href: "/account/notifications", label: "Alerts", icon: "alerts" },
  { href: "/account/profile", label: "Profile", icon: "profile" },
];

export const driverNav: AppNavItem[] = [
  { href: "/driver", label: "Home", icon: "home" },
  { href: "/driver/jobs", label: "Jobs", icon: "jobs" },
  { href: "/driver/messages", label: "Messages", icon: "messages" },
  { href: "/driver/notifications", label: "Alerts", icon: "alerts" },
  { href: "/driver/profile", label: "Profile", icon: "profile" },
];

export function appNavActive(pathname: string, href: string): boolean {
  if (href === "/account") return pathname === "/account";
  if (href === "/driver") return pathname === "/driver";
  if (href === "/driver/jobs") return pathname === "/driver/jobs" || pathname.startsWith("/driver/jobs/");
  const path = href.split("#")[0];
  if (path === "/account/jobs") {
    return pathname === path || pathname.startsWith(`${path}/`) || pathname.startsWith("/jobs/");
  }
  return pathname === path || pathname.startsWith(`${path}/`);
}
