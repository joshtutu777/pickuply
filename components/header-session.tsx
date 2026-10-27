import { firstName } from "@/lib/auth/name";
import { homeFor } from "@/lib/auth/mode";
import { readMode } from "@/lib/auth/mode-cookie";
import { getOptionalSession } from "@/lib/auth/session";
import { cityFromArea } from "@/lib/jobs/next-action";
import { createClient } from "@/lib/supabase/server";
import { SiteHeader } from "@/components/site-header";
import { CustomerOfferWatch } from "@/components/account/offer-watch";
import { LiveAlerts } from "@/components/notifications/live-alerts";
import { customerNav, driverNav, type AppNavItem } from "@/lib/app-nav";

const customerAccountLinks = [
  { href: "/account/jobs#offers", label: "Offers" },
  { href: "/help", label: "Help" },
];

const customerDesktopNav: AppNavItem[] = [
  ...customerNav,
  { href: "/account/jobs#offers", label: "Offers", icon: "jobs" },
  { href: "/help", label: "Help", icon: "alerts" },
];
import { roleBadgeForHome } from "@/lib/auth/role-badge";

export async function HeaderSession() {
  const session = await getOptionalSession();
  if (!session) return <SiteHeader state={{ status: "signed-out" }} />;
  const supabase = await createClient();
  const [{ count }, inbox] = await Promise.all([
    supabase.from("notifications").select("id", { count: "exact", head: true }).is("read_at", null),
    supabase.rpc("my_inbox"),
  ]);
  const messageUnread = ((inbox.data ?? []) as { unread?: number }[]).reduce(
    (sum, row) => sum + Number(row.unread ?? 0),
    0,
  );
  const mode = await readMode();
  const { data: driver } = await supabase
    .from("drivers")
    .select("home_city")
    .eq("profile_id", session.userId)
    .maybeSingle();
  const hasDriver = Boolean(driver) || session.role === "driver";
  const homeHref = homeFor({ role: session.role, mode, hasDriver });
  let offerUnread = 0;
  if (homeHref === "/account") {
    const counts = await supabase.rpc("customer_offer_counts");
    offerUnread = ((counts.data ?? []) as { new_offers?: number }[]).reduce(
      (sum, row) => sum + Number(row.new_offers ?? 0),
      0,
    );
  }
  const alertsHref =
    homeHref === "/driver"
      ? "/driver/notifications"
      : homeHref === "/admin"
        ? "/admin/notifications"
        : "/account/notifications";
  let area: string | null = null;
  if (hasDriver) {
    area = driver?.home_city?.trim() || null;
  } else if (session.role === "customer") {
    const { data } = await supabase
      .from("jobs")
      .select("pickup_area")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    area = cityFromArea(data?.pickup_area);
  }
  return (
    <>
    {homeHref === "/account" ? <CustomerOfferWatch /> : null}
    <LiveAlerts />
    <SiteHeader
      state={{
        status: "signed-in",
        firstName: firstName(session.fullName),
        alertsHref,
        unread: count ?? 0,
        area,
        appNav: homeHref === "/account" || homeHref === "/driver",
        appLabel: homeHref === "/driver" ? "Driver" : homeHref === "/account" ? "Customer" : null,
        roleBadge: roleBadgeForHome(homeHref),
        appLinks:
          homeHref === "/driver"
            ? [...driverNav, { href: "/help", label: "Help", icon: "profile" }]
            : homeHref === "/account"
              ? customerDesktopNav
              : customerNav,
        accountLinks:
          homeHref === "/account"
            ? customerAccountLinks
            : homeHref === "/driver"
              ? [{ href: "/help", label: "Help" }]
              : null,
        messageUnread,
        offerUnread,
        homeHref,
        driveHref: hasDriver ? "/driver" : "/driver/onboarding",
      }}
    />
    </>
  );
}
