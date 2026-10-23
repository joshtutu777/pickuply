import { getOptionalSession } from "@/lib/auth/session";
import { BottomNav } from "@/components/mobile/bottom-nav";

export async function MobileFrame() {
  const session = await getOptionalSession();
  return <BottomNav role={session?.role ?? null} />;
}
