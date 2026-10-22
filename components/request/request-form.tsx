"use client";

import dynamic from "next/dynamic";
import type { ServiceId } from "@/lib/constants";

const RequestWizard = dynamic(
  () => import("./request-wizard").then((mod) => mod.RequestWizard),
  {
    ssr: false,
    loading: () => (
      <main className="mx-auto w-full max-w-xl flex-1 px-4 py-10 text-lg text-muted">
        Loading the request form.
      </main>
    ),
  },
);

export function RequestForm({ initialService }: { initialService: ServiceId | null }) {
  return <RequestWizard initialService={initialService} />;
}
