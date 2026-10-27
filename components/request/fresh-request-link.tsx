"use client";

import { freshRequestHref } from "@/lib/request/fresh-request";

export function FreshRequestLink({
  service,
  className,
  children,
}: {
  service?: string | null;
  className?: string;
  children: React.ReactNode;
}) {
  const href = service ? `/request?service=${encodeURIComponent(service)}` : "/request";
  return (
    <a
      href={href}
      className={className}
      onClick={(event) => {
        event.preventDefault();
        window.location.assign(freshRequestHref(service));
      }}
    >
      {children}
    </a>
  );
}
