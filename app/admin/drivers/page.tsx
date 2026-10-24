import Link from "next/link";
import { Suspense } from "react";
import { StatusChip } from "@/components/admin/status-chip";
import { LoadingMain } from "@/components/loading-main";
import { expiringDrivers, loadAdminDashboard } from "@/lib/admin/load";
import { documentExpiresSoon, driverQueueLabel, filterDrivers, onlineByZone, sortDriverQueue, waitLabel, type AdminDriver } from "@/lib/admin/ops";
import { IncludeTestData } from "@/components/admin/include-test-data";
import { includeTestParam } from "@/lib/admin/test-lane";
import { resolveTestLane } from "@/lib/admin/test-lane-server";
import { requireAdmin } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export default function AdminDriversPage({ searchParams }: PageProps<"/admin/drivers">) {
  return (
    <Suspense fallback={<LoadingMain />}>
      <DriversContent searchParams={searchParams} />
    </Suspense>
  );
}

async function DriversContent({ searchParams }: { searchParams: PageProps<"/admin/drivers">["searchParams"] }) {
  await requireAdmin("/admin/drivers");
  const params = await searchParams;
  const status = one(params.status);
  const online = one(params.online);
  const zone = one(params.zone);
  const covers = one(params.covers).trim();
  const lane = await resolveTestLane(includeTestParam(params.includeTest));
  const data = await loadAdminDashboard(lane);
  if (data.error) {
    return (
      <main className="px-4 py-8">
        <p className="text-sm font-semibold tracking-wide text-brand uppercase">Admin</p>
        <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight text-ink">Drivers</h1>
        {lane === "test" ? null : (
          <IncludeTestData include={lane === "all"} path="/admin/drivers" search={lane === "all" ? "includeTest=1" : ""} />
        )}
        <p role="alert" className="mt-6 text-lg text-danger">
          We couldn&apos;t load drivers. Try again.
        </p>
      </main>
    );
  }
  let drivers = data.drivers;
  if (covers) {
    const supabase = await createClient();
    const { data: covered } = await supabase.rpc("drivers_covering_pickup", { pickup_area: covers });
    const allowed = new Set((covered ?? []).map((row: { profile_id: string }) => row.profile_id));
    drivers = drivers.filter((driver) => allowed.has(driver.id));
  }

  return (
    <main className="px-4 py-8">
      <p className="text-sm font-semibold tracking-wide text-brand uppercase">Admin</p>
      <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight text-ink">Drivers</h1>
      {lane === "test" ? null : (
        <IncludeTestData include={lane === "all"} path="/admin/drivers" search={lane === "all" ? "includeTest=1" : ""} />
      )}
      <DriverList
        drivers={sortDriverQueue(filterDrivers(drivers, { status, online, zone }))}
        covers={covers}
        everyone={data.drivers}
        zones={data.zones}
        now={data.now}
        status={status}
      />
    </main>
  );
}

function DriverList({
  drivers,
  everyone,
  zones,
  now,
  status,
  covers,
}: {
  drivers: AdminDriver[];
  everyone: AdminDriver[];
  zones: { id: string; name: string }[];
  now: number;
  status: string;
  covers: string;
}) {
  const zoneNames = new Map(zones.map((zone) => [zone.id, zone.name]));
  const online = onlineByZone(everyone, zoneNames);
  const expiring = expiringDrivers(everyone, now);
  const filters = [
    ["", "All"],
    ["pending_review", "Pending"],
    ["approved_new", "Approved, new"],
    ["active", "Active"],
    ["paused", "Paused"],
  ] as const;

  return (
    <>
      <div className="mt-4 flex flex-wrap gap-2">
        {filters.map(([value, label]) => (
          <Link
            key={value || "all"}
            href={value ? `/admin/drivers?status=${value}` : "/admin/drivers"}
            aria-current={status === value ? "page" : undefined}
            className={`inline-flex min-h-12 items-center rounded-full px-4 text-base font-semibold ${
              status === value ? "bg-brand text-white" : "bg-paper-raised text-ink ring-1 ring-line"
            }`}
          >
            {label}
          </Link>
        ))}
      </div>
      <form className="mt-6" action="/admin/drivers">
        <label className="block text-base font-semibold text-ink" htmlFor="covers">
          Coverage includes this pickup city or ZIP
          <input
            id="covers"
            name="covers"
            defaultValue={covers}
            className="mt-2 min-h-12 w-full rounded-2xl border border-line bg-paper-raised px-4"
          />
        </label>
        <button type="submit" className="mt-3 inline-flex min-h-12 items-center font-semibold text-brand">
          Filter drivers
        </button>
      </form>
      <h2 className="mt-8 text-xl font-semibold text-ink">Online right now</h2>
      {online.length === 0 ? (
        <p className="mt-2 text-base text-muted">No drivers are online.</p>
      ) : (
        <ul className="mt-2 space-y-1">
          {online.map((item) => (
            <li key={item.name} className="text-base text-ink">
              {item.name}: {item.count}
            </li>
          ))}
        </ul>
      )}
      <h2 className="mt-8 text-xl font-semibold text-ink">Documents expiring within 30 days</h2>
      {expiring.length === 0 ? (
        <p className="mt-2 text-base text-muted">No licenses or insurance expire within 30 days.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {expiring.map((driver) => (
            <li key={driver.id}>
              <Link href={`/admin/drivers/${driver.id}`} className="inline-flex min-h-12 items-center font-semibold text-brand">
                {driver.name || "Applicant"}
                {documentExpiresSoon(driver.licenseExpires, now) ? " · license" : ""}
                {documentExpiresSoon(driver.insuranceExpires, now) ? " · insurance" : ""}
              </Link>
            </li>
          ))}
        </ul>
      )}
      {drivers.length === 0 ? (
        <p className="mt-6 text-base leading-relaxed text-muted">No driver applications yet.</p>
      ) : (
        <ul className="mt-6 space-y-3">
          {drivers.map((driver) => {
            const licenseSoon = documentExpiresSoon(driver.licenseExpires, now);
            const insuranceSoon = documentExpiresSoon(driver.insuranceExpires, now);
            return (
              <li key={driver.id}>
                <Link
                  href={`/admin/drivers/${driver.id}`}
                  className="block min-h-12 rounded-3xl bg-paper-raised p-4 ring-1 ring-line"
                >
                  <span className="block text-lg font-semibold text-ink">{driver.name || "Applicant"}</span>
                  <span className="mt-1 block text-base text-muted">
                    {driver.homeCity || "No city"}
                    {driver.coverage ? ` · ${driver.coverage}` : ""}
                    {" · "}
                    {new Date(driver.createdAt).toLocaleDateString()}
                    {" · "}
                    {waitLabel(driver.createdAt, now)}
                  </span>
                  <span className="mt-2 inline-flex">
                    <StatusChip value={driverQueueLabel(driver).toLowerCase().replaceAll(" ", "_")} kind="driver" />
                  </span>
                  {licenseSoon || insuranceSoon ? (
                    <span className="mt-2 block text-base font-semibold text-danger">
                      {licenseSoon ? "License expires within 30 days. " : ""}
                      {insuranceSoon ? "Insurance expires within 30 days." : ""}
                    </span>
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

function one(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}
