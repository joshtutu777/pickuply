import type { Metadata } from "next";
import { Suspense } from "react";
import { MessageInbox } from "@/components/messages/inbox";
import { LoadingMain } from "@/components/loading-main";
import { requireSignedIn } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Messages" };

export default function DriverMessagesPage({
  searchParams,
}: {
  searchParams: Promise<{ thread?: string }>;
}) {
  return (
    <Suspense fallback={<LoadingMain />}>
      <DriverMessages searchParams={searchParams} />
    </Suspense>
  );
}

async function DriverMessages({ searchParams }: { searchParams: Promise<{ thread?: string }> }) {
  await requireSignedIn("/driver/messages");
  const query = await searchParams;
  return (
    <MessageInbox
      backHref="/driver"
      backLabel="Driver home"
      listHref="/driver/messages"
      threadId={typeof query.thread === "string" ? query.thread : null}
    />
  );
}
