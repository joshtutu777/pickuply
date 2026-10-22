import { createBrowserClient } from "@supabase/ssr";
import { supabaseProjectUrl } from "./project-url";

function publicConfig(): { url: string; anonKey: string } {
  const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const url = rawUrl ? supabaseProjectUrl(rawUrl) : rawUrl;
  if (!url || !anonKey) {
    throw new Error("Supabase URL and anon key are required in the browser.");
  }
  return { url, anonKey };
}

/** Browser client. Uses the anon key only. */
export function createClient() {
  const { url, anonKey } = publicConfig();
  return createBrowserClient(url, anonKey);
}
