import { createClient } from "@/lib/supabase/client";

const storageKey = "pickuply.funnel";

export function funnelSessionId(): string {
  if (typeof window === "undefined") return crypto.randomUUID();
  const existing = window.sessionStorage.getItem(storageKey);
  if (existing) return existing;
  const created = crypto.randomUUID();
  window.sessionStorage.setItem(storageKey, created);
  return created;
}

export async function recordFunnel(input: {
  event: string;
  step?: string;
  service?: string | null;
  pricing?: string | null;
  zone?: string | null;
  source?: string | null;
}): Promise<void> {
  try {
    await createClient().rpc("record_funnel_event", {
      event_name: input.event,
      step: input.step ?? "",
      service: input.service || null,
      pricing_method: input.pricing || null,
      zone_slug: input.zone || null,
      session_id: funnelSessionId(),
      source: input.source || null,
    });
  } catch {
    // A missed analytics row never blocks the person using the app.
  }
}
