import Link from "next/link";

const links = [
  ["inbox", "/admin/sms", "Inbox"],
  ["compose", "/admin/sms/compose", "Compose"],
  ["scheduled", "/admin/sms/scheduled", "Scheduled"],
  ["sent", "/admin/sms/sent", "Sent"],
  ["recipients", "/admin/sms/recipients", "Recipients"],
] as const;

export function SmsSectionNav({ current }: { current: (typeof links)[number][0] }) {
  return (
    <nav aria-label="Text messages" className="mt-4 flex gap-2 overflow-x-auto pb-1">
      {links.map(([id, href, label]) => (
        <Link
          key={id}
          href={href}
          aria-current={current === id ? "page" : undefined}
          className={`inline-flex min-h-11 shrink-0 items-center rounded-full px-4 text-sm font-semibold ${
            current === id ? "bg-brand text-white" : "bg-paper-raised text-ink ring-1 ring-line"
          }`}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}

export function deliveryLabel(status: string): string {
  if (status === "queued") return "Waiting to send";
  if (status === "accepted") return "Accepted";
  if (status === "sent") return "Sent";
  if (status === "delivered") return "Delivered";
  if (status === "failed") return "Failed";
  if (status === "skipped") return "Skipped";
  if (status === "undelivered") return "Undelivered";
  return "Unknown";
}
