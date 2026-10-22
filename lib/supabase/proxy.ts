import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { accessStateFromProfile, decideAccess, isRole } from "@/lib/auth/access";

type PendingCookie = {
  name: string;
  value: string;
  options: CookieOptions;
};

/**
 * Refreshes the signed-in session on each matched request, then applies the access rules.
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
  const jar: PendingCookie[] = [];
  const extraHeaders: Record<string, string> = {};

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers = {}) {
        for (const cookie of cookiesToSet) {
          const index = jar.findIndex((item) => item.name === cookie.name);
          if (index >= 0) jar[index] = cookie;
          else jar.push(cookie);
          request.cookies.set(cookie.name, cookie.value);
        }
        Object.assign(extraHeaders, headers);
        response = NextResponse.next({ request });
        applyAuth(response, jar, extraHeaders);
      },
    },
    global: {
      fetch(input, init) {
        return fetch(input, { ...init, signal: AbortSignal.timeout(4000) });
      },
    },
  });

  let state = accessStateFromProfile({ signedIn: false, role: null, fullName: null });
  try {
    const { data, error } = await supabase.auth.getUser();
    if (!error && data.user) {
      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("role, full_name")
        .eq("id", data.user.id)
        .maybeSingle();
      if (profileError || !profile) {
        state = accessStateFromProfile({ signedIn: true, role: null, fullName: null });
      } else {
        const role = typeof profile.role === "string" && isRole(profile.role) ? profile.role : null;
        const fullName = typeof profile.full_name === "string" ? profile.full_name : null;
        state = accessStateFromProfile({ signedIn: true, role, fullName });
      }
    }
  } catch {
    // A slow or unreachable Supabase must not block the local form.
    return response;
  }

  const decision = decideAccess({
    pathname: request.nextUrl.pathname,
    search: request.nextUrl.search,
    state,
  });
  if (decision.type === "allow") return response;

  const location = decision.location;
  if (!location.startsWith("/") || location.startsWith("//")) return response;
  const target = new URL(location, request.url);
  if (target.origin !== request.nextUrl.origin) return response;
  if (target.pathname === request.nextUrl.pathname && target.search === request.nextUrl.search) {
    return response;
  }

  const redirectResponse = NextResponse.redirect(target, 303);
  applyAuth(redirectResponse, jar, extraHeaders);
  return redirectResponse;
}

function applyAuth(
  target: NextResponse,
  cookiesToSet: PendingCookie[],
  headers: Record<string, string>,
) {
  for (const { name, value, options } of cookiesToSet) {
    target.cookies.set(name, value, options);
  }
  for (const [key, value] of Object.entries(headers)) {
    target.headers.set(key, value);
  }
}
