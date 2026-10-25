import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { BackLink } from "@/components/back-link";
import { LoadingMain } from "@/components/loading-main";
import { DetailReply } from "@/components/request/detail-reply";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Add details" };

export default function EditRequestPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<LoadingMain />}>
      <EditRequest params={params} />
    </Suspense>
  );
}

async function EditRequest({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  const supabase = await createClient();
  const details = await supabase.rpc("open_detail_request", { target_job: id });
  const body =
    details.data && typeof details.data === "object"
      ? (details.data as { items?: unknown; note?: unknown })
      : null;
  const items = Array.isArray(body?.items)
    ? body.items.filter((item): item is string => typeof item === "string")
    : [];
  const note = typeof body?.note === "string" ? body.note : "";

  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-4 py-8">
      <BackLink href={`/jobs/${id}`} label="Request" />
      <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight text-ink">Add details</h1>
      {items.length > 0 ? (
        <DetailReply jobId={id} items={items} note={note} />
      ) : (
        <p className="mt-6 text-lg text-muted">There is nothing to add on this request right now.</p>
      )}
      <p className="mt-6">
        <Link href={`/jobs/${id}`} className="inline-flex min-h-12 items-center font-semibold text-brand">
          Back to the request
        </Link>
      </p>
    </main>
  );
}
