import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import "server-only";
import { supabaseProjectUrl } from "./project-url";

/**
 * Server client for Server Components and route handlers.
 * The session cookie is refreshed in proxy.ts. Setting cookies from a
 * Server Component can fail, and that failure is ignored on purpose.
 */
export async function createClient() {
  const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const url = rawUrl ? supabaseProjectUrl(rawUrl) : rawUrl;
  if (!url || !anonKey) {
    throw new Error("Supabase URL and anon key are required on the server.");
  }

  const cookieStore = await cookies();

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Components cannot always write cookies. The proxy refresh still runs.
        }
      },
    },
  });
}
