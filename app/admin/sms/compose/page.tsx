import type { Metadata } from "next";
import { Suspense } from "react";
import { SmsComposeForm } from "@/components/admin/sms-compose-form";
import { SmsSectionNav } from "@/components/admin/sms-section";
import { LoadingMain } from "@/components/loading-main";
import { requireAdmin } from "@/lib/auth/session";
import { formatUsPhone } from "@/lib/phone";
import { createClient } from "@/lib/supabase/server";
import type { SmsPerson } from "@/app/admin/sms/actions";

export const metadata: Metadata = { title: { absolute: "Compose text · Pickuply Admin" } };

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default function ComposePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <Suspense fallback={<LoadingMain />}>
      <Compose searchParams={searchParams} />
    </Suspense>
  );
}

async function Compose({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdmin("/admin/sms/compose");
  const query = await searchParams;
  const ids = (Array.isArray(query.ids) ? query.ids : typeof query.ids === "string" ? [query.ids] : []).filter((id) => uuidPattern.test(id));
  const supabase = await createClient();
  const people: SmsPerson[] = [];
  for (const id of ids.slice(0, 25)) {
    const found = await supabase.rpc("admin_sms_search", { query: id });
    const row = ((found.data ?? []) as Array<{
      profile_id: string;
      full_name: string;
      role: string;
      phone: string | null;
      sms_enabled: boolean;
      opted_out: boolean;
      suspended: boolean;
    }>).find((item) => item.profile_id === id);
    if (!row) continue;
    people.push({
      id: row.profile_id,
      name: row.full_name,
      role: row.role,
      phone: formatUsPhone(row.phone ?? "") ?? "No US phone",
      note: row.opted_out ? "Replied STOP" : row.suspended ? "Suspended" : row.sms_enabled ? "Optional alerts on" : "Optional alerts off",
    });
  }

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
      <p className="text-sm font-semibold tracking-wide text-brand uppercase">Admin</p>
      <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight text-ink">New Text Message</h1>
      <SmsSectionNav current="compose" />
      <SmsComposeForm initialPeople={people} />
    </main>
  );
}
