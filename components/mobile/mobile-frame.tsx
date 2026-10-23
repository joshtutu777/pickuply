import { getOptionalSession } from "@/lib/auth/session";
import { BottomNav } from "@/components/mobile/bottom-nav";
import { createClient } from "@/lib/supabase/server";

export async function MobileFrame() {
  const session = await getOptionalSession();
  let messageUnread = 0;
  if (session) {
    const supabase = await createClient();
    const { data } = await supabase.rpc("my_inbox");
    messageUnread = ((data ?? []) as { unread?: number }[]).reduce((sum, row) => sum + Number(row.unread ?? 0), 0);
  }
  return <BottomNav role={session?.role ?? null} messageUnread={messageUnread} />;
}
