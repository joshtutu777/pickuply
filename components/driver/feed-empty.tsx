import { Inbox, MapPin } from "lucide-react";
import Link from "next/link";
import { SharePickuply } from "@/components/driver/share-pickuply";
import {
  driverEmptyLinks,
  georgiaEmptyMessage,
  georgiaEmptyTitle,
  matchedEmptyMessage,
  matchedEmptyTitle,
} from "@/lib/ui/marketplace-empty";

const linkClass = "inline-flex min-h-12 items-center font-semibold text-brand";

export function MatchedEmpty({
  payoutReady,
  notificationsOn,
  onAreas,
}: {
  payoutReady: boolean;
  notificationsOn: boolean;
  onAreas: () => void;
}) {
  const links = driverEmptyLinks({ payoutReady, notificationsOn });
  return (
    <div className="mt-3 rounded-3xl bg-brand-soft p-5 ring-1 ring-brand/15">
      <Inbox className="size-8 text-brand" aria-hidden="true" />
      <h3 className="mt-3 text-xl font-semibold text-ink">{matchedEmptyTitle}</h3>
      <p className="mt-2 text-base leading-relaxed text-ink">{matchedEmptyMessage}</p>
      <ul className="mt-4 grid gap-1">
        <li>
          <button type="button" onClick={onAreas} className={linkClass}>
            Areas I cover
          </button>
        </li>
        {links.payout ? (
          <li>
            <Link href="/driver/earnings" className={linkClass}>
              Finish payout setup
            </Link>
          </li>
        ) : null}
        {links.notifications ? (
          <li>
            <Link href="/driver/notifications" className={linkClass}>
              Turn on notifications
            </Link>
          </li>
        ) : null}
        <li>
          <SharePickuply className={linkClass} />
        </li>
      </ul>
    </div>
  );
}

export function GeorgiaEmpty() {
  return (
    <div className="mt-4 rounded-3xl bg-brand-soft p-5 ring-1 ring-brand/15">
      <MapPin className="size-8 text-brand" aria-hidden="true" />
      <h3 className="mt-3 text-xl font-semibold text-ink">{georgiaEmptyTitle}</h3>
      <p className="mt-2 text-base leading-relaxed text-ink">{georgiaEmptyMessage}</p>
    </div>
  );
}
