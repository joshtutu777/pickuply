import Link from "next/link";
import { phoneReuseNotice, restrictionNotice } from "@/lib/account/restriction";
import { createClient } from "@/lib/supabase/server";

export async function RestrictionNotice({ surface }: { surface: "customer" | "driver" }) {
  const supabase = await createClient();
  const [{ data }, { data: phoneBlocked }] = await Promise.all([
    supabase.rpc("my_account_restriction"),
    supabase.rpc("my_phone_restricted"),
  ]);
  const notice = restrictionNotice(surface, data);
  if (!notice && phoneBlocked === true) {
    return (
      <div role="status" className="mt-4 rounded-3xl bg-paper-raised p-4 text-base text-ink ring-1 ring-line">
        <p>{phoneReuseNotice}</p>
        <Link href="/help?appeal=1" className="mt-3 inline-flex min-h-12 items-center font-semibold text-brand">
          Contact support
        </Link>
      </div>
    );
  }
  if (!notice) return null;
  return (
    <div role="status" className="mt-4 rounded-3xl bg-paper-raised p-4 text-base text-ink ring-1 ring-line">
      <p>
        {notice.body}
        {notice.until ? <span className="mt-2 block">Ends {notice.until}.</span> : null}
      </p>
      <Link href="/help?appeal=1" className="mt-3 inline-flex min-h-12 items-center font-semibold text-brand">
        Contact support
      </Link>
    </div>
  );
}
