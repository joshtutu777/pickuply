import Link from "next/link";

export function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} prefetch={false} className="mb-3 inline-flex min-h-12 items-center font-semibold text-brand">
      {`← ${label}`}
    </Link>
  );
}
