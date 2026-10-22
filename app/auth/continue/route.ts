import { connection } from "next/server";
import { redirect } from "next/navigation";
import { continueDestination, safeNextParam } from "@/lib/auth/access";
import { getOptionalSession } from "@/lib/auth/session";

export async function GET(request: Request) {
  await connection();
  const next = safeNextParam(new URL(request.url).searchParams.get("next"));
  const session = await getOptionalSession();

  if (!session) {
    redirect(next ? `/login?${new URLSearchParams({ next }).toString()}` : "/login");
  }
  if (!session.role) redirect("/login?error=profile");
  if (!session.fullName?.trim()) {
    redirect(next ? `/login/name?${new URLSearchParams({ next }).toString()}` : "/login/name");
  }
  redirect(continueDestination(session.role, next));
}
