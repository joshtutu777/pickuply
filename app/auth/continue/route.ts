import { connection } from "next/server";
import { redirect } from "next/navigation";
import { authLocation, continueDestination, safeIntent, safeNextParam } from "@/lib/auth/access";
import { getOptionalSession } from "@/lib/auth/session";

export async function GET(request: Request) {
  await connection();
  const url = new URL(request.url);
  const next = safeNextParam(url.searchParams.get("next"));
  const intent = safeIntent(url.searchParams.get("intent"));
  const session = await getOptionalSession();

  if (!session) {
    redirect(authLocation("/login", next, intent));
  }
  if (!session.role) redirect("/login?error=profile");
  if (!session.fullName?.trim()) {
    redirect(authLocation("/login/name", next, intent));
  }
  redirect(continueDestination(session.role, next, intent));
}
