import {
  formatScheduledPickup,
  scheduleLockedMessage,
  windowIsOpen,
  type PickupWindowPlan,
} from "@/lib/time/pickup-schedule";

export function ScheduledPickup({
  availability,
  start,
  end,
  windows = [],
  locked = false,
}: {
  availability?: string | null;
  start?: string | null;
  end?: string | null;
  windows?: PickupWindowPlan[];
  locked?: boolean;
}) {
  if (start) {
    return (
      <section aria-label="Scheduled Pickup" className="mt-3 rounded-2xl bg-brand-soft px-4 py-3">
        <p className="text-sm font-semibold tracking-wide text-brand uppercase">Scheduled Pickup</p>
        <p className="text-lg font-semibold text-ink">{formatScheduledPickup(start, end ?? null)}</p>
        {windows.length > 0 ? (
          <p className="mt-1 text-base text-ink">
            Availability: {windows.map((window) => formatScheduledPickup(window.starts_at, window.ends_at)).join("; ")}
          </p>
        ) : null}
        {locked ? <p className="mt-1 text-base text-ink">{scheduleLockedMessage}</p> : null}
      </section>
    );
  }
  if (availability === "anytime") {
    return (
      <p className="mt-3 text-base text-ink">
        Available anytime. The driver proposes a pickup time and will not arrive unannounced.
      </p>
    );
  }
  if (availability === "asap") {
    return (
      <p className="mt-3 text-base text-ink">
        As soon as possible. The driver proposes their earliest realistic arrival. This does not promise an immediate pickup.
      </p>
    );
  }
  const openWindows = windows.filter((window) => windowIsOpen(window.ends_at));
  if (availability === "windows" && openWindows.length > 0) {
    return (
      <section className="mt-3 grid gap-1">
        <p className="text-sm font-semibold tracking-wide text-brand uppercase">Pickup windows</p>
        {openWindows.map((window) => (
          <p key={window.id} className="text-base text-ink">
            {formatScheduledPickup(window.starts_at, window.ends_at)}
          </p>
        ))}
      </section>
    );
  }
  return null;
}

