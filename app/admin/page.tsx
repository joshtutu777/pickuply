import type { Metadata } from "next";
import { Suspense } from "react";
import { LoadingMain } from "@/components/loading-main";
import { PlaceholderPage } from "@/components/placeholder-page";
import { singleQuery } from "@/lib/auth/query";
import { requireAdmin } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "Admin",
};

export default function AdminPage({ searchParams }: PageProps<"/admin">) {
  return (
    <Suspense fallback={<LoadingMain />}>
      <AdminContent searchParams={searchParams} />
    </Suspense>
  );
}

async function AdminContent({
  searchParams,
}: {
  searchParams: PageProps<"/admin">["searchParams"];
}) {
  await requireAdmin("/admin");
  const params = await searchParams;
  return (
    <PlaceholderPage
      eyebrow="Admin"
      title="Admin"
      description="Operations tools will live here. The admin dashboard is not built yet."
      forbidden={singleQuery(params.error) === "forbidden"}
    />
  );
}
