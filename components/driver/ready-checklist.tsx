import Link from "next/link";

export function ReadyChecklist({
  items,
}: {
  items: { id: string; label: string; href: string; done: boolean }[];
}) {
  const done = items.filter((item) => item.done).length;
  return (
    <section className="mt-6 rounded-3xl bg-paper-raised p-4 ring-1 ring-line">
      <h2 className="font-display text-2xl font-semibold text-ink">Get Ready to Drive</h2>
      <p className="mt-2 text-base text-muted">
        {done} of {items.length} complete. Approval alone does not let you go Online.
      </p>
      <ul className="mt-4 space-y-2">
        {items.map((item) => (
          <li key={item.id}>
            <Link href={item.href} className="flex min-h-12 items-center justify-between gap-3 font-semibold text-brand">
              <span>{item.label}</span>
              <span>{item.done ? "Done" : "Open"}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
