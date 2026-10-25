import { homeFor } from "@/lib/auth/mode";
import { readMode } from "@/lib/auth/mode-cookie";
import { getOptionalSession } from "@/lib/auth/session";
import { BottomNav } from "@/components/mobile/bottom-nav";
import { createClient } from "@/lib/supabase/server";

export async function MobileFrame() {
  const session = await getOptionalSession();
  let messageUnread = 0;
  let alertUnread = 0;
  let offerUnread = 0;
  let surface: "customer" | "driver" | "admin" | null = session?.role ?? null;
  if (session) {
    const supabase = await createClient();
    const [{ data }, alerts] = await Promise.all([
      supabase.rpc("my_inbox"),
      supabase.from("notifications").select("id", { count: "exact", head: true }).is("read_at", null),
    ]);
    messageUnread = ((data ?? []) as { unread?: number }[]).reduce((sum, row) => sum + Number(row.unread ?? 0), 0);
    alertUnread = alerts.count ?? 0;
    const mode = await readMode();
    const { data: driver } = await supabase.from("drivers").select("profile_id").eq("profile_id", session.userId).maybeSingle();
    const home = homeFor({ role: session.role, mode, hasDriver: Boolean(driver) || session.role === "driver" });
    surface = home === "/driver" ? "driver" : home === "/admin" ? "admin" : "customer";
    if (surface === "customer") {
      const counts = await supabase.rpc("customer_offer_counts");
      offerUnread = ((counts.data ?? []) as { new_offers?: number }[]).reduce(
        (sum, row) => sum + Number(row.new_offers ?? 0),
        0,
      );
    }
  }
  return <BottomNav role={surface} messageUnread={messageUnread} alertUnread={alertUnread} offerUnread={offerUnread} />;
}
