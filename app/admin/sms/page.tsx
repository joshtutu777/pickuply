import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { SmsSectionNav } from "@/components/admin/sms-section";
import { LoadingMain } from "@/components/loading-main";
import { requireAdmin } from "@/lib/auth/session";
import { formatUsPhone } from "@/lib/phone";
import { createClient } from "@/lib/supabase/server";
import { formatUsWhen } from "@/lib/time/when";

export const metadata: Metadata = { title: { absolute: "Texts · Pickuply Admin" } };

export default function SmsInboxPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <Suspense fallback={<LoadingMain />}>
      <Inbox searchParams={searchParams} />
    </Suspense>
  );
}

async function Inbox({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdmin("/admin/sms");
  const query = await searchParams;
  const filter = typeof query.filter === "string" ? query.filter : "all";
  const q = typeof query.q === "string" ? query.q.trim() : "";
  const supabase = await createClient();
  let request = supabase.from("sms_threads").select("id, phone, contact_name, contact_role, unread_count, last_body, last_at, profile_id").order("last_at", { ascending: false }).limit(50);
  if (filter === "unread") request = request.gt("unread_count", 0);
  if (filter === "unmatched") request = request.is("profile_id", null);
  if (filter === "customer" || filter === "driver") request = request.eq("contact_role", filter);
  if (q) {
    const safe = q.replace(/[^a-zA-Z0-9 ]/g, "").slice(0, 40);
    const digits = q.replace(/\D/g, "").slice(0, 15);
    if (safe && digits) request = request.or(`contact_name.ilike.%${safe}%,phone.ilike.%${digits}%`);
    else if (safe) request = request.ilike("contact_name", `%${safe}%`);
    else if (digits) request = request.ilike("phone", `%${digits}%`);
  }
  const { data, error } = await request;
  const rows = data ?? [];
  const filters = [
    ["all", "All"],
    ["unread", "Unread"],
    ["unmatched", "Unknown numbers"],
    ["driver", "Drivers"],
    ["customer", "Customers"],
  ];

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
      <p className="text-sm font-semibold tracking-wide text-brand uppercase">Admin</p>
      <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight text-ink">Texts</h1>
      <p className="mt-3 text-base text-ink">Replies stay here. They do not change a booking, a driver, or a payment. Sign-in codes are separate.</p>
      <SmsSectionNav current="inbox" />
      <form className="mt-4 flex gap-2" action="/admin/sms">
        <input type="hidden" name="filter" value={filter} />
        <label className="sr-only" htmlFor="sms-search">Search conversations</label>
        <input id="sms-search" name="q" defaultValue={q} placeholder="Name or phone" className="min-h-12 flex-1 rounded-2xl border border-line bg-paper px-4" />
        <button className="inline-flex min-h-12 items-center rounded-full bg-brand px-4 font-semibold text-white" type="submit">Search</button>
      </form>
      <div className="mt-3 flex gap-2 overflow-x-auto">
        {filters.map(([id, label]) => (
          <Link key={id} href={id === "all" ? "/admin/sms" : `/admin/sms?filter=${id}`} className="inline-flex min-h-11 items-center rounded-full px-3 text-sm font-semibold text-ink ring-1 ring-line">
            {label}
          </Link>
        ))}
      </div>
      {error ? <p role="alert" className="mt-4 text-base text-danger">Conversations could not be loaded.</p> : null}
      {!error && rows.length === 0 ? <p className="mt-6 text-base text-muted">No conversations yet.</p> : null}
      <ul className="mt-4 grid gap-3">
        {rows.map((row) => (
          <li key={row.id}>
            <Link href={`/admin/sms/${row.id}`} className="block rounded-3xl bg-paper-raised p-4 ring-1 ring-line">
              <p className="font-semibold text-ink">
                {row.contact_name ?? "Unknown number"}
                {row.unread_count > 0 ? <span className="ml-2 rounded-full bg-brand px-2 py-1 text-xs text-white">{row.unread_count} new</span> : null}
              </p>
              <p className="mt-1 text-sm text-muted">{formatUsPhone(row.phone) ?? "Hidden number"} · {row.contact_role ?? "No account"}{row.last_at ? ` · ${formatUsWhen(row.last_at)}` : ""}</p>
              <p className="mt-2 text-base text-ink">{row.last_body ?? "No message yet"}</p>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
