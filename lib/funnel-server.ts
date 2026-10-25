import "server-only";
import { createClient } from "@/lib/supabase/server";

export async function recordFunnelServer(input: {
  event: string;
  step?: string;
  service?: string | null;
  pricing?: string | null;
  zone?: string | null;
  source?: string | null;
  sessionId?: string;
}): Promise<void> {
  try {
    const supabase = await createClient();
    const { data } = await supabase.auth.getUser();
    await supabase.rpc("record_funnel_event", {
      event_name: input.event,
      step: input.step ?? "",
      service: input.service || null,
      pricing_method: input.pricing || null,
      zone_slug: input.zone || null,
      session_id: input.sessionId ?? data.user?.id ?? crypto.randomUUID(),
      source: input.source || null,
    });
  } catch {
    // A missed analytics row never blocks the person using the app.
  }
}
