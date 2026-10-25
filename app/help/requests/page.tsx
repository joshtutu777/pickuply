import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { LoadingMain } from "@/components/loading-main";
import { requireSignedIn } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "My requests" };

const labels: Record<string, string> = { open: "Open", waiting: "Waiting on you", resolved: "Resolved" };

export default function HelpRequestsPage() {
  return (
    <Suspense fallback={<LoadingMain />}>
      <Requests />
    </Suspense>
  );
}

async function Requests() {
  await requireSignedIn("/help/requests");
  const supabase = await createClient();
  const { data } = await supabase.from("help_requests").select("id, case_number, topic, status, created_at").order("created_at", { ascending: false });
  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-4 py-8">
      <Link href="/help" className="inline-flex min-h-12 items-center font-semibold text-brand">
        ← Help
      </Link>
      <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight text-ink">My requests</h1>
      {(data ?? []).length === 0 ? <p className="mt-4 text-base text-muted">No requests yet.</p> : null}
      <ul className="mt-4 space-y-3">
        {(data ?? []).map((request) => (
          <li key={request.id}>
            <Link href={`/help/requests/${request.id}`} className="block min-h-12 rounded-3xl bg-paper-raised p-4 ring-1 ring-line">
              <span className="font-semibold text-ink">{request.case_number}</span>
              <span className="mt-1 block text-base text-muted">
                {request.topic} · {labels[request.status] ?? request.status}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
