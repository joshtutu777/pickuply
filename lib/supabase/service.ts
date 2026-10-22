import "server-only";

import { createClient } from "@supabase/supabase-js";
import { supabaseProjectUrl } from "./project-url";

/** Server-only client for cron and other system tasks. Never import this from a browser component. */
export function createServiceClient() {
  const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const url = rawUrl ? supabaseProjectUrl(rawUrl) : rawUrl;
  if (!url || !key) {
    throw new Error("Service role is not configured.");
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
