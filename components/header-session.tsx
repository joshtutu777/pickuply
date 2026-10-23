import { firstName } from "@/lib/auth/name";
import { getOptionalSession } from "@/lib/auth/session";
import { cityFromArea } from "@/lib/jobs/next-action";
import { createClient } from "@/lib/supabase/server";
import { SiteHeader } from "@/components/site-header";

export async function HeaderSession() {
  const session = await getOptionalSession();
  if (!session) return <SiteHeader state={{ status: "signed-out" }} />;
  const supabase = await createClient();
  const { count } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .is("read_at", null);
  const alertsHref =
    session.role === "driver"
      ? "/driver/notifications"
      : session.role === "admin"
        ? "/admin/notifications"
        : "/account/notifications";
  let area: string | null = null;
  if (session.role === "driver") {
    const { data } = await supabase.from("drivers").select("home_city").eq("profile_id", session.userId).maybeSingle();
    area = data?.home_city?.trim() || null;
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
    <SiteHeader
      state={{
        status: "signed-in",
        firstName: firstName(session.fullName),
        alertsHref,
        unread: count ?? 0,
        area,
        appNav: session.role === "customer" || session.role === "driver",
      }}
    />
  );
}
