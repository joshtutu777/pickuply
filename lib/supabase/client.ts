import { createBrowserClient } from "@supabase/ssr";

function publicConfig(): { url: string; anonKey: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
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
