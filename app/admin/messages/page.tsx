import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { startAdminMessage } from "@/app/admin/messages/actions";
import { AdminMessageList } from "@/components/admin/admin-messages";
import { LoadingMain } from "@/components/loading-main";
import { IncludeTestData } from "@/components/admin/include-test-data";
import { includeTestParam } from "@/lib/admin/test-lane";
import { resolveTestLane } from "@/lib/admin/test-lane-server";
import { requireAdmin } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: { absolute: "Messages · Pickuply Admin" } };

export default function AdminMessagesPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; includeTest?: string }>;
}) {
  return (
    <Suspense fallback={<LoadingMain />}>
      <AdminMessages searchParams={searchParams} />
    </Suspense>
  );
}

async function AdminMessages({ searchParams }: { searchParams: Promise<{ error?: string; includeTest?: string }> }) {
  await requireAdmin("/admin/messages");
  const query = await searchParams;
  const lane = await resolveTestLane(includeTestParam(query.includeTest));
  const supabase = await createClient();
  const [{ data: people }, { data: help }] = await Promise.all([
    supabase.rpc("admin_message_directory"),
    supabase.from("help_requests").select("id, case_number, status").neq("status", "resolved").order("created_at", { ascending: false }).limit(20),
  ]);
  const directory = (people ?? []) as { profile_id: string; label: string; person_role: string }[];

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
      <p className="text-sm font-semibold tracking-wide text-brand uppercase">Admin</p>
      <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight text-ink">Messages</h1>
      {lane === "test" ? null : (
        <IncludeTestData include={lane === "all"} path="/admin/messages" search={lane === "all" ? "includeTest=1" : ""} />
      )}
      {typeof query.error === "string" ? (
        <p role="alert" className="mt-4 text-base text-danger">
          {query.error}
        </p>
      ) : null}
      <AdminMessageList includeTest={lane === "all"} />
      <form action={startAdminMessage} className="mt-8 grid gap-3 rounded-3xl bg-paper-raised p-4 ring-1 ring-line">
        <h2 className="font-display text-2xl font-semibold text-ink">Start a conversation</h2>
        <label className="text-base font-semibold text-ink" htmlFor="profileId">
          Driver or customer
          <select id="profileId" name="profileId" required className="mt-2 min-h-12 w-full rounded-2xl border border-line bg-paper px-4">
            <option value="">Choose someone</option>
            {directory.map((person) => (
              <option key={person.profile_id} value={person.profile_id}>
                {person.label} · {person.person_role}
              </option>
            ))}
          </select>
          <span className="mt-2 block text-sm">
            {directory.map((person) => (
              <Link key={person.profile_id} href={person.person_role === "driver" ? `/admin/drivers/${person.profile_id}` : `/admin/customers/${person.profile_id}`} className="mr-3 inline-flex min-h-12 items-center font-semibold text-brand">
                {person.person_role === "driver" ? "Driver" : "Customer"} record
              </Link>
            ))}
          </span>
        </label>
        <label className="text-base font-semibold text-ink" htmlFor="note">
          Message
          <textarea id="note" name="note" required minLength={1} className="mt-2 min-h-24 w-full rounded-2xl border border-line bg-paper px-4 py-3" />
        </label>
        <button type="submit" className="inline-flex min-h-12 items-center justify-center rounded-full bg-brand px-6 font-semibold text-white">
          Send
        </button>
      </form>
      <section className="mt-8">
        <h2 className="font-display text-2xl font-semibold text-ink">Help cases</h2>
        {(help ?? []).length === 0 ? (
          <p className="mt-3 text-base text-muted">No open help cases.</p>
        ) : (
          <ul className="mt-3 grid gap-2">
            {(help ?? []).map((item) => (
              <li key={item.id}>
                <Link href={`/admin/help/${item.id}`} className="inline-flex min-h-12 items-center font-semibold text-brand">
                  {item.case_number} · {item.status}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
