import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { AccountControls } from "@/components/admin/account-controls";
import { BackLink } from "@/components/back-link";
import { LoadingMain } from "@/components/loading-main";
import { requireAdmin } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: { absolute: "Customer · Pickuply Admin" } };

type CustomerPageProps = {
  params: Promise<Record<string, string | string[] | undefined>>;
};

export default function CustomerPage({ params }: CustomerPageProps) {
  return (
    <Suspense fallback={<LoadingMain />}>
      <Customer params={params} />
    </Suspense>
  );
}

async function Customer({ params }: CustomerPageProps) {
  await requireAdmin("/admin/customers");
  const { id } = await params;
  const customerId = typeof id === "string" ? id : "";
  if (!/^[0-9a-f-]{36}$/i.test(customerId)) notFound();
  const supabase = await createClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, full_name, phone, role, deleted_at, reclaim_hold_at, created_at")
    .eq("id", customerId)
    .maybeSingle();
  if (!profile) notFound();
  const [{ data: jobs }, { data: reviews }, { data: help }, { data: threads }, { data: deletion }, { data: audit }] = await Promise.all([
    supabase.from("jobs").select("id, service, status, payment_status, captured_cents, pickup_area, created_at").or(`customer_id.eq.${customerId},assigned_driver_id.eq.${customerId}`).order("created_at", { ascending: false }).limit(20),
    supabase.from("job_reviews").select("id, stars, body, created_at, job_id").or(`reviewer_id.eq.${customerId},reviewee_id.eq.${customerId}`).order("created_at", { ascending: false }).limit(10),
    supabase.from("help_requests").select("id, case_number, topic, status").eq("profile_id", customerId).order("created_at", { ascending: false }).limit(10),
    supabase.from("message_threads").select("id, kind, created_at").or(`requester_id.eq.${customerId},driver_id.eq.${customerId}`).order("created_at", { ascending: false }).limit(10),
    supabase.from("account_deletion_requests").select("status, grace_ends_at, requested_at").eq("profile_id", customerId).order("requested_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("audit_log").select("id, action, created_at").or(`target_id.eq.${customerId},actor_id.eq.${customerId}`).order("created_at", { ascending: false }).limit(20),
  ]);

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
      <BackLink href="/admin/customers" label="Customers" />
      <p className="text-sm font-semibold tracking-wide text-brand uppercase">Admin</p>
      <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight text-ink">{profile.full_name ?? "Unnamed"}</h1>
      <dl className="mt-4 grid gap-2 text-base text-ink">
        <div><dt className="font-semibold">Phone</dt><dd>{profile.phone ?? "No phone"}</dd></div>
        <div><dt className="font-semibold">Role</dt><dd>{profile.role}</dd></div>
        <div><dt className="font-semibold">Account</dt><dd>{profile.deleted_at ? "Deleted" : profile.reclaim_hold_at ? "Frozen for phone review" : "Open"}</dd></div>
      </dl>
      <AccountControls profileId={profile.id} returnTo={`/admin/customers/${profile.id}`} label="Suspension" />
      <section className="mt-8">
        <h2 className="font-display text-2xl font-semibold text-ink">Deletion</h2>
        <p className="mt-2 text-base text-ink">{deletion?.status ? deletion.status : "No deletion request."}</p>
      </section>
      <Section title="Jobs and payments" empty={(jobs ?? []).length === 0}>
        {(jobs ?? []).map((job) => (
          <li key={job.id}>
            <Link href={`/admin/requests/${job.id}`} className="font-semibold text-brand">
              {job.service} · {job.status} · {job.payment_status ?? "no payment"}{job.captured_cents ? ` · $${(job.captured_cents / 100).toFixed(2)}` : ""}
            </Link>
          </li>
        ))}
      </Section>
      <Section title="Reviews" empty={(reviews ?? []).length === 0}>
        {(reviews ?? []).map((review) => (
          <li key={review.id} className="text-base text-ink">{review.stars} stars{review.body ? ` · ${review.body}` : ""}</li>
        ))}
      </Section>
      <Section title="Help requests" empty={(help ?? []).length === 0}>
        {(help ?? []).map((item) => (
          <li key={item.id}><Link href={`/admin/help/${item.id}`} className="font-semibold text-brand">{item.case_number} · {item.topic}</Link></li>
        ))}
      </Section>
      <Section title="Messages" empty={(threads ?? []).length === 0}>
        {(threads ?? []).map((thread) => (
          <li key={thread.id}><Link href={`/admin/messages/${thread.id}`} className="font-semibold text-brand">{thread.kind}</Link></li>
        ))}
      </Section>
      <Section title="Audit history" empty={(audit ?? []).length === 0}>
        {(audit ?? []).map((entry) => (
          <li key={entry.id} className="text-base text-ink">{entry.action}</li>
        ))}
      </Section>
    </main>
  );
}

function Section({ title, empty, children }: { title: string; empty: boolean; children: ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="font-display text-2xl font-semibold text-ink">{title}</h2>
      {empty ? <p className="mt-2 text-base text-muted">None.</p> : <ul className="mt-2 grid gap-2">{children}</ul>}
    </section>
  );
}
