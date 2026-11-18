import type { Metadata } from "next";
import { Suspense } from "react";
import { SmsSectionNav } from "@/components/admin/sms-section";
import { LoadingMain } from "@/components/loading-main";
import { requireAdmin } from "@/lib/auth/session";
import { formatUsPhone } from "@/lib/phone";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: { absolute: "Text recipients · Pickuply Admin" } };

type Person = {
  profile_id: string;
  full_name: string;
  role: string;
  phone: string | null;
  is_online: boolean;
  promotional: boolean;
  sms_enabled: boolean;
  opted_out: boolean;
  suspended: boolean;
};

export default function RecipientsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <Suspense fallback={<LoadingMain />}>
      <Recipients searchParams={searchParams} />
    </Suspense>
  );
}

function eligibility(person: Person): string {
  if (person.opted_out) return "Opted out";
  if (person.suspended) return "Suspended";
  if (person.promotional) return person.is_online ? "Promotional texts on · Online" : "Promotional texts on";
  if (person.sms_enabled) return "Optional alerts on, promotional texts off";
  return "No optional texts";
}

async function Recipients({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdmin("/admin/sms/recipients");
  const query = await searchParams;
  const q = typeof query.q === "string" ? query.q.trim() : "";
  const supabase = await createClient();
  const found = q.length >= 2 ? await supabase.rpc("admin_sms_search", { query: q }) : { data: [], error: null };
  const rows = (found.data ?? []) as Person[];

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
      <p className="text-sm font-semibold tracking-wide text-brand uppercase">Admin</p>
      <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight text-ink">Recipients</h1>
      <p className="mt-3 text-base text-ink">Search by name, phone, or customer or driver. Test accounts stay in the test lane.</p>
      <SmsSectionNav current="recipients" />
      <form className="mt-4 flex gap-2" action="/admin/sms/recipients">
        <label className="sr-only" htmlFor="recipient-search">Search people</label>
        <input id="recipient-search" name="q" defaultValue={q} className="min-h-12 flex-1 rounded-2xl border border-line bg-paper px-4" />
        <button className="inline-flex min-h-12 items-center rounded-full bg-brand px-4 font-semibold text-white" type="submit">Search</button>
      </form>
      {found.error ? <p role="alert" className="mt-4 text-base text-danger">The search could not be completed.</p> : null}
      {!found.error && q.length >= 2 && rows.length === 0 ? <p className="mt-6 text-base text-muted">No matching people.</p> : null}
      {q.length < 2 ? <p className="mt-6 text-base text-muted">Enter at least two characters.</p> : null}
      {rows.length > 0 ? (
        <form action="/admin/sms/compose" className="mt-4 grid gap-3">
          <ul className="grid gap-3">
            {rows.map((person) => (
              <li key={person.profile_id} className="rounded-3xl bg-paper-raised p-4 ring-1 ring-line">
                <label className="flex min-h-12 items-start gap-3">
                  <input type="checkbox" name="ids" value={person.profile_id} className="mt-1" />
                  <span>
                    <span className="block font-semibold text-ink">{person.full_name}</span>
                    <span className="mt-1 block text-sm text-muted">{person.role} · {formatUsPhone(person.phone ?? "") ?? "No US phone"} · {eligibility(person)}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <button type="submit" className="inline-flex min-h-12 items-center justify-center rounded-full bg-brand px-6 font-semibold text-white">Use selected in a text</button>
        </form>
      ) : null}
    </main>
  );
}
