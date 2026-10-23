import Link from "next/link";
import type { ChecklistItem } from "@/lib/driver/checklist";
import { checklistProgress } from "@/lib/driver/checklist";

const markLabel = {
  todo: "To do",
  uploaded: "Uploaded",
  done: "Done",
  needs_changes: "Needs changes",
} as const;

const actionLabel = {
  todo: "Start",
  uploaded: "Edit",
  done: "Edit",
  needs_changes: "Fix",
} as const;

export function ReadyChecklist({
  items,
  statusLine,
  collapsed,
}: {
  items: ChecklistItem[];
  statusLine: string | null;
  collapsed: boolean;
}) {
  const { done, total } = checklistProgress(items);
  const body = (
    <section className="mt-6 rounded-3xl bg-paper-raised p-4 ring-1 ring-line" aria-label="Get Ready to Drive">
      <h2 className="font-display text-2xl font-semibold text-ink">Get Ready to Drive</h2>
      <p className="mt-2 text-base font-semibold text-ink">
        {done} of {total} completed
      </p>
      <div
        className="mt-3 h-2 overflow-hidden rounded-full bg-line"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={done}
        aria-label="Checklist progress"
      >
        <div className="h-full bg-brand" style={{ width: `${total === 0 ? 0 : (done / total) * 100}%` }} />
      </div>
      {statusLine ? <p className="mt-3 text-base text-ink">{statusLine}</p> : null}
      <p className="mt-2 text-base text-muted">Finish these steps. Once we approve you, you can go Online.</p>
      <ul className="mt-4 space-y-2">
        {items.map((item) => (
          <li key={item.id} className="rounded-2xl px-1 py-2">
            <Link href={item.href} className="flex min-h-12 items-center justify-between gap-3 font-semibold text-ink">
              <span>
                {item.mark === "needs_changes" ? "⚠️" : item.mark === "todo" ? "⬜" : "✅"} {item.label}
              </span>
              <span className="text-brand">
                {markLabel[item.mark]} · {actionLabel[item.mark]}
              </span>
            </Link>
            {item.note ? <p className="mt-1 text-base text-ink">{item.note}</p> : null}
          </li>
        ))}
      </ul>
    </section>
  );
  return (
    <div id="checklist">
      {collapsed ? (
        <details className="mt-6">
          <summary className="inline-flex min-h-12 cursor-pointer items-center font-semibold text-brand">
            Profile complete
          </summary>
          {body}
        </details>
      ) : (
        body
      )}
    </div>
  );
}
