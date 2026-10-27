import { SiteFooter } from "@/components/site-footer";
import { getOptionalSession } from "@/lib/auth/session";

/** Signed-in app pages keep Help. Blog and Contact stay on the public site. */
export async function FooterSession() {
  const session = await getOptionalSession();
  return <SiteFooter showPublicLinks={!session} />;
}
