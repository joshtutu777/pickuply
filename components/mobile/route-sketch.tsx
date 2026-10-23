export function RouteSketch({
  from,
  to,
  updated,
}: {
  from: string;
  to: string | null;
  updated: string | null;
}) {
  return (
    <section className="rounded-3xl bg-brand-soft px-4 py-5 ring-1 ring-brand/15" aria-label="Route">
      <div className="flex items-center gap-3">
        <span className="grid size-10 place-items-center rounded-full bg-ink text-white" aria-hidden="true">
          <span className="size-2 rounded-full bg-white" />
        </span>
        <span className="h-0.5 flex-1 border-t-2 border-dashed border-brand" aria-hidden="true" />
        <span className="grid size-10 place-items-center rounded-full bg-brand text-sm font-semibold text-white" aria-hidden="true">
          {to ? "B" : "A"}
        </span>
      </div>
      <p className="mt-4 text-base font-semibold text-ink">
        {from}
        {to ? ` → ${to}` : ""}
      </p>
      {updated ? (
        <p className="mt-1 text-sm text-muted">
          Last updated <time dateTime={updated}>{new Date(updated).toLocaleString()}</time>
        </p>
      ) : null}
    </section>
  );
}
