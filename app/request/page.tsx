import type { Metadata } from "next";
import { Suspense } from "react";
import { RequestForm } from "@/components/request/request-form";
import { serviceFromQuery } from "@/lib/constants";

export const metadata: Metadata = {
  title: "Request a pickup",
};

export default function RequestPage({ searchParams }: PageProps<"/request">) {
  return (
    <Suspense
      fallback={
        <main className="mx-auto w-full max-w-xl flex-1 px-4 py-10 text-lg text-muted">
          Loading the request form.
        </main>
      }
    >
      <RequestEntry searchParams={searchParams} />
    </Suspense>
  );
}

async function RequestEntry({
  searchParams,
}: {
  searchParams: PageProps<"/request">["searchParams"];
}) {
  const params = await searchParams;
  const value = Array.isArray(params.service) ? params.service[0] : params.service;
  const fresh = Array.isArray(params.new) ? params.new[0] : params.new;
  return <RequestForm initialService={serviceFromQuery(value)} freshKey={fresh ?? ""} />;
}
