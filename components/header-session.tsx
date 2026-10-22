import { firstName } from "@/lib/auth/name";
import { getOptionalSession } from "@/lib/auth/session";
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
  return (
    <SiteHeader
      state={{
        status: "signed-in",
        firstName: firstName(session.fullName),
        alertsHref,
        unread: count ?? 0,
      }}
    />
  );
}
