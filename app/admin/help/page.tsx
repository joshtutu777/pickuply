import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { LoadingMain } from "@/components/loading-main";
import { requireAdmin } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Help queue" };

const labels: Record<string, string> = { open: "Open", waiting: "Waiting on you", resolved: "Resolved" };

export default function AdminHelpPage() {
  return (
    <Suspense fallback={<LoadingMain />}>
      <Queue />
    </Suspense>
  );
}

async function Queue() {
  await requireAdmin("/admin/help");
  const supabase = await createClient();
  const { data } = await supabase
    .from("help_request_list")
    .select("id, case_number, topic, status, created_at, profile_id, waited_minutes")
    .order("created_at", { ascending: true });
  return (
    <main className="px-4 py-8">
      <h1 className="font-display text-4xl font-semibold tracking-tight text-ink">Help</h1>
      <ul className="mt-6 space-y-3">
        {(data ?? []).map((request) => (
          <li key={request.id}>
            <Link href={`/admin/help/${request.id}`} className="block rounded-3xl bg-paper-raised p-4 ring-1 ring-line">
              <span className="font-semibold text-ink">{request.case_number}</span>
              <span className="mt-1 block text-base text-muted">
                {request.topic} · {labels[request.status] ?? request.status} · Waiting {request.waited_minutes} min
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
