import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Refreshes the signed-in session on each matched request.
 * Next.js 16 uses proxy.ts instead of middleware.ts, and this file runs on the Node.js runtime.
 * If the public Supabase settings are missing, the request continues so the local form still works.
 */
export async function updateSession(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    return NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
    global: {
      fetch(input, init) {
        return fetch(input, { ...init, signal: AbortSignal.timeout(4000) });
      },
    },
  });

  try {
    await supabase.auth.getUser();
  } catch {
    // A slow or unreachable Supabase must not block the local form.
  }
  return response;
}
