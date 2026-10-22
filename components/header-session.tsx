import { firstName } from "@/lib/auth/name";
import { getOptionalSession } from "@/lib/auth/session";
import { SiteHeader } from "@/components/site-header";

export async function HeaderSession() {
  const session = await getOptionalSession();
  if (!session) return <SiteHeader state={{ status: "signed-out" }} />;
  return (
    <SiteHeader
      state={{ status: "signed-in", firstName: firstName(session.fullName) }}
    />
  );
}
