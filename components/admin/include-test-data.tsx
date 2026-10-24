import Link from "next/link";

export function IncludeTestData({
  include,
  path,
  search,
}: {
  include: boolean;
  path: string;
  search: string;
}) {
  const params = new URLSearchParams(search);
  if (include) params.delete("includeTest");
  else params.set("includeTest", "1");
  const query = params.toString();
  const href = query ? `${path}?${query}` : path;

  return (
    <p className="mt-3 text-sm text-muted">
      <Link href={href} className="font-semibold text-brand">
        {include ? "Hide test data" : "Include test data"}
      </Link>
      {include ? " Test accounts are included in this view." : " Test accounts are hidden."}
    </p>
  );
}
