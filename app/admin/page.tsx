import Link from "next/link";
import { Suspense } from "react";
import { RefreshButton } from "@/components/admin/admin-refresh";
import { BadgeChip } from "@/components/admin/status-chip";
import { LoadingMain } from "@/components/loading-main";
import { expiringDrivers, loadAdminDashboard } from "@/lib/admin/load";
import {
  documentExpiresSoon,
  onlineByZone,
  readableTime,
  waitedLabel,
} from "@/lib/admin/ops";
import { requireAdmin } from "@/lib/auth/session";

export default function AdminPage() {
  return (
    <Suspense fallback={<LoadingMain />}>
      <Overview />
    </Suspense>
  );
}

async function Overview() {
  await requireAdmin("/admin");
  const data = await loadAdminDashboard();
  if (data.error) {
    return (
      <main className="px-4 py-8">
        <PageHeading />
        <p role="alert" className="mt-6 text-lg text-danger">
          We couldn&apos;t load the dashboard. Try again.
        </p>
      </main>
    );
  }

  const zoneNames = new Map(data.zones.map((zone) => [zone.id, zone.name]));
  const online = onlineByZone(data.drivers, zoneNames);
  const expiring = expiringDrivers(data.drivers, data.now);
  const approvedNew = data.drivers.filter((driver) => driver.status === "approved_new").length;
  const active = data.drivers.filter((driver) => driver.status === "active").length;
  const paused = data.drivers.filter((driver) => driver.status === "paused").length;
  const paymentText = data.counts.soonestPaymentDue
    ? `Soonest deadline ${readableTime(data.counts.soonestPaymentDue, data.now)}`
    : "No payment deadline yet";

  const cards = [
    { href: "/admin/requests", count: data.counts.total, label: "Total jobs", detail: "Every request" },
    {
      href: "/admin/requests?status=new",
      count: data.counts.newRequests,
      label: "New requests awaiting review",
      detail: "Requested or in review",
    },
    {
      href: "/admin/requests?status=quoted",
      count: data.counts.quotes,
      label: "Quotes awaiting customer acceptance",
      detail:
        data.counts.quotesSoon === 1
          ? "1 expires within 2 hours"
          : `${data.counts.quotesSoon} expire within 2 hours`,
    },
    {
      href: "/admin/requests?status=open",
      count: data.counts.open,
      label: "Open jobs awaiting drivers",
      detail:
        data.counts.openStale === 1
          ? "1 has no offers after 20 minutes"
          : `${data.counts.openStale} have no offers after 20 minutes`,
    },
    {
      href: "/admin/requests?stage=active",
      count: data.counts.active,
      label: "Active/assigned jobs",
      detail: "Assigned through delivered",
    },
    {
      href: "/admin/requests?payment=awaiting_payment",
      count: data.counts.awaitingPayment,
      label: "Jobs awaiting payment",
      detail: paymentText,
    },
    {
      href: "/admin/requests?status=completed",
      count: data.counts.completed,
      label: "Completed jobs",
      detail: "Finished trips",
    },
    {
      href: "/admin/drivers?status=pending_review",
      count: data.counts.pendingDrivers,
      label: "Pending driver applications",
      detail: "Waiting for your review",
    },
  ];

  return (
    <main className="px-4 py-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <PageHeading />
        <RefreshButton />
      </div>
      <div className="mt-8 flex flex-col gap-10">
        <section className="order-1 md:order-2" aria-labelledby="needs-action-heading">
          <h2 id="needs-action-heading" className="font-display text-3xl font-semibold text-ink">
            Needs your action
          </h2>
          {data.needs.length === 0 ? (
            <p className="mt-4 rounded-3xl bg-paper-raised p-5 text-base text-muted ring-1 ring-line">
              Nothing needs you right now.
            </p>
          ) : (
            <ul className="mt-4 space-y-3">
              {data.needs.map((item) => (
                <li key={item.id} className="rounded-3xl bg-paper-raised p-4 ring-1 ring-line">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-lg font-semibold text-ink">{item.service}</p>
                      <p className="mt-1 text-base text-muted">
                        {item.pricingMethod} · {item.area}
                      </p>
                      <p className="mt-1 text-base text-ink">{waitedLabel(item.since, data.now)}</p>
                    </div>
                    <Link
                      href={item.href}
                      className="inline-flex min-h-12 items-center justify-center rounded-full bg-brand px-5 text-base font-semibold text-white"
                    >
                      {item.action}
                    </Link>
                  </div>
                  {item.badges.length > 0 ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {item.badges.map((badge) => (
                        <BadgeChip key={badge} label={badge} />
                      ))}
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="order-2 md:order-1" aria-labelledby="summary-heading">
          <h2 id="summary-heading" className="font-display text-3xl font-semibold text-ink">
            At a glance
          </h2>
          <ul className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {cards.map((card) => (
              <li key={card.href + card.label}>
                <Link href={card.href} className="block min-h-12 rounded-3xl bg-paper-raised p-4 ring-1 ring-line">
                  <span className="block font-display text-4xl font-semibold text-ink">{card.count}</span>
                  <span className="mt-2 block text-base font-semibold text-ink">{card.label}</span>
                  <span className="mt-1 block text-sm text-muted">{card.detail}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <section className="order-3" aria-labelledby="drivers-heading">
          <h2 id="drivers-heading" className="font-display text-3xl font-semibold text-ink">
            Drivers
          </h2>
          <ul className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <CountLink href="/admin/drivers?status=pending_review" count={data.counts.pendingDrivers} label="Pending approvals" />
            <CountLink href="/admin/drivers?status=approved_new" count={approvedNew} label="Approved, new" />
            <CountLink href="/admin/drivers?status=active" count={active} label="Approved, active" />
            <CountLink href="/admin/drivers?status=paused" count={paused} label="Paused" />
          </ul>
          <h3 className="mt-6 text-xl font-semibold text-ink">Online right now</h3>
          {online.length === 0 ? (
            <p className="mt-2 text-base text-muted">No drivers are online.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {online.map((zone) => (
                <li key={zone.name}>
                  <Link
                    href={zone.zoneId ? `/admin/drivers?online=1&zone=${zone.zoneId}` : "/admin/drivers?online=1"}
                    className="inline-flex min-h-12 items-center text-base font-semibold text-brand"
                  >
                    {zone.name}: {zone.count}
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <h3 className="mt-6 text-xl font-semibold text-ink">Documents expiring within 30 days</h3>
          {expiring.length === 0 ? (
            <p className="mt-2 text-base text-muted">No licenses or insurance expire within 30 days.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {expiring.map((driver) => (
                <li key={driver.id}>
                  <Link
                    href={`/admin/drivers/${driver.id}`}
                    className="inline-flex min-h-12 items-center text-base font-semibold text-brand"
                  >
                    {driver.name || "Applicant"}
                    {documentExpiresSoon(driver.licenseExpires, data.now) ? " · license" : ""}
                    {documentExpiresSoon(driver.insuranceExpires, data.now) ? " · insurance" : ""}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="order-4" aria-labelledby="activity-heading">
          <h2 id="activity-heading" className="font-display text-3xl font-semibold text-ink">
            Recent activity
          </h2>
          {data.activity.length === 0 ? (
            <p className="mt-4 text-base text-muted">No activity yet.</p>
          ) : (
            <ul className="mt-4 space-y-3">
              {data.activity.map((item) => (
                <li key={item.id} className="rounded-3xl bg-paper-raised p-4 ring-1 ring-line">
                  <p className="text-sm font-semibold text-muted">{readableTime(item.at, data.now)}</p>
                  <p className="mt-1 text-base text-ink">
                    {item.actor} · {item.label}
                  </p>
                  {item.href ? (
                    <Link href={item.href} className="mt-2 inline-flex min-h-12 items-center font-semibold text-brand">
                      Open
                    </Link>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}

function PageHeading() {
  return (
    <div>
      <p className="text-sm font-semibold tracking-wide text-brand uppercase">Admin</p>
      <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight text-ink">Admin</h1>
    </div>
  );
}

function CountLink({ href, count, label }: { href: string; count: number; label: string }) {
  return (
    <li>
      <Link href={href} className="block min-h-12 rounded-3xl bg-paper-raised p-4 ring-1 ring-line">
        <span className="block text-3xl font-semibold text-ink">{count}</span>
        <span className="mt-1 block text-base font-semibold text-ink">{label}</span>
      </Link>
    </li>
  );
}
