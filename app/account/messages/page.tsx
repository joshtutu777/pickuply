import type { Metadata } from "next";
import { Suspense } from "react";
import { MessageInbox } from "@/components/messages/inbox";
import { LoadingMain } from "@/components/loading-main";
import { requireSignedIn } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Messages" };

export default function MessagesPage({
  searchParams,
}: {
  searchParams: Promise<{ thread?: string }>;
}) {
  return (
    <Suspense fallback={<LoadingMain />}>
      <MessagesContent searchParams={searchParams} />
    </Suspense>
  );
}

async function MessagesContent({ searchParams }: { searchParams: Promise<{ thread?: string }> }) {
  await requireSignedIn("/account/messages");
  const query = await searchParams;
  return (
    <MessageInbox
      backHref="/account"
      backLabel="Account"
      listHref="/account/messages"
      threadId={typeof query.thread === "string" ? query.thread : null}
    />
  );
}
