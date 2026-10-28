import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { SmsCampaignForm } from "@/components/admin/sms-campaign-form";
import { LoadingMain } from "@/components/loading-main";
import { requireAdmin } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: { absolute: "SMS campaigns · Pickuply Admin" } };

export default function SmsCampaignsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <Suspense fallback={<LoadingMain />}>
      <SmsCampaigns searchParams={searchParams} />
    </Suspense>
  );
}

async function SmsCampaigns({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin("/admin/communications/sms");
  const query = await searchParams;
  const error = typeof query.error === "string" ? query.error : "";
  const supabase = await createClient();
  const { data } = await supabase
    .from("sms_campaigns")
    .select("id, name, status, purpose, scheduled_for, estimated_phones, eligible_phones")
    .order("created_at", { ascending: false })
    .limit(30);
  const rows = data ?? [];

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
      <p className="text-sm font-semibold tracking-wide text-brand uppercase">Admin</p>
      <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight text-ink">SMS campaigns</h1>
      <p className="mt-3 text-base text-ink">
        One text to a chosen group. In-app announcements stay on Communications.
      </p>
      <p className="mt-3">
        <Link href="/admin/communications" className="inline-flex min-h-12 items-center font-semibold text-brand">
          Back to Communications
        </Link>
      </p>
      {error ? <p role="alert" className="mt-4 text-base text-danger">{error}</p> : null}
      {query.saved === "draft" ? <p className="mt-4 text-base font-semibold text-ink">Draft saved. Nothing was sent.</p> : null}
      {query.saved === "scheduled" ? <p className="mt-4 text-base font-semibold text-ink">Scheduled. Texting is still off, so the scheduler will record the result and will not text anyone.</p> : null}
      <SmsCampaignForm />
      <section className="mt-8">
        <h2 className="font-display text-2xl font-semibold text-ink">Drafts and sends</h2>
        {rows.length === 0 ? <p className="mt-3 text-base text-muted">No text campaigns yet.</p> : null}
        <ul className="mt-3 grid gap-3">
          {rows.map((row) => (
            <li key={row.id}>
              <Link href={`/admin/communications/sms/${row.id}`} className="block rounded-3xl bg-paper-raised p-4 ring-1 ring-line">
                <p className="font-semibold text-ink">{row.name}</p>
                <p className="mt-1 text-base text-muted">
                  {row.status === "sent" ? "Finished" : row.status} · {row.purpose === "account_support" ? "Account support" : "Marketing"} · {row.eligible_phones ?? row.estimated_phones} phones
                </p>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
