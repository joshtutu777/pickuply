import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { reopenDriver, requestDocuments, reviewDriver } from "@/app/admin/drivers/actions";
import { AccountControls } from "@/components/admin/account-controls";
import { BackLink } from "@/components/back-link";
import { LoadingMain } from "@/components/loading-main";
import { coverageSummary } from "@/lib/driver/coverage";
import { formatUsPhone } from "@/lib/phone";
import { connectLivemode } from "@/lib/payments/connect-eligibility";
import { paymentsMode } from "@/lib/payments/payments-mode";
import { requireAdmin } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

const actions = [
  ["approve_active", "Approve driver"],
  ["decline", "Decline"],
  ["pause", "Pause"],
  ["remove", "Remove"],
] as const;

const documentItems = ["license", "vehicle", "insurance", "services", "equipment", "agreement", "training"] as const;

export default function AdminDriverPage({
  searchParams,
  params,
}: PageProps<"/admin/drivers/[id]">) {
  return (
    <Suspense fallback={<LoadingMain />}>
      <DriverDetail params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function signed(path: string | null) {
  if (!path) return null;
  const supabase = await createClient();
  const { data } = await supabase.storage.from("driver-docs").createSignedUrl(path, 300);
  return data?.signedUrl ?? null;
}

async function DriverDetail({
  params,
  searchParams,
}: {
  params: PageProps<"/admin/drivers/[id]">["params"];
  searchParams: PageProps<"/admin/drivers/[id]">["searchParams"];
}) {
  await requireAdmin("/admin/drivers");
  const { id } = await params;
  const query = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createClient();
  const { data: driver } = await supabase.from("drivers").select("*").eq("profile_id", id).maybeSingle();
  if (!driver) notFound();
  const [{ data: profile }, { data: vehicle }, { data: payout }, { data: coverage }] = await Promise.all([
    supabase.from("profiles").select("full_name, phone, role, photo_url").eq("id", id).maybeSingle(),
    supabase
      .from("vehicles")
      .select("type, make, model, year, plate, cargo_length_in, photo_url, approved")
      .eq("driver_id", id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("driver_connect_accounts")
      .select("payouts_enabled, transfers_active, details_submitted, requirements_due, disabled_reason")
      .eq("driver_id", id)
      .eq("livemode", connectLivemode(paymentsMode(process.env.PAYMENTS_MODE)))
      .maybeSingle(),
    supabase
      .from("driver_feed_filters")
      .select("cities, zips, radius_miles")
      .eq("profile_id", id)
      .maybeSingle(),
  ]);
  const areas = coverage
    ? coverageSummary({
        cities: coverage.cities ?? [],
        zips: coverage.zips ?? [],
        radiusMiles: coverage.radius_miles,
      })
    : "";
  const [licenseUrl, insuranceUrl, profileUrl, vehicleUrl] = await Promise.all([
    signed(driver.license_url),
    signed(driver.insurance_url),
    signed(profile?.photo_url ?? null),
    signed(vehicle?.photo_url ?? null),
  ]);

  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-4 py-8">
      <BackLink href="/admin/drivers" label="Drivers" />
      <p className="text-sm font-semibold tracking-wide text-brand uppercase">Admin</p>
      <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight text-ink">
        {profile?.full_name || "Applicant"}
      </h1>
      <p className="mt-2 text-base text-muted">
        {driver.status.replaceAll("_", " ")} · role {profile?.role}
      </p>
      <p className="mt-2 text-base text-ink">
        Phone: {profile?.phone ? formatUsPhone(profile.phone) ?? profile.phone : "No phone on file"}
      </p>
      {driver.license_url ? <p className="mt-2 text-base text-ink">License on file</p> : null}
      {driver.status === "removed" ? (
        <form action={reopenDriver} className="mt-4">
          <input type="hidden" name="driverId" value={id} />
          <button type="submit" className="inline-flex min-h-12 items-center justify-center rounded-full bg-brand px-6 font-semibold text-white">
            Reopen application
          </button>
        </form>
      ) : null}
      <p className="mt-2 text-base text-ink">
        Payout setup:{" "}
        {payout?.payouts_enabled && payout.transfers_active
          ? "ready to receive transfers"
          : payout
            ? "started, not ready"
            : "not started"}
        {payout?.disabled_reason ? " · Stripe paused this account" : ""}
        {payout && (payout.requirements_due ?? []).length > 0 ? ` · ${(payout.requirements_due ?? []).length} item(s) still due in Stripe` : ""}
      </p>
      <Link href="/admin/drivers" className="mt-4 inline-flex min-h-12 items-center font-semibold text-brand">
        All drivers
      </Link>
      {query.saved === "1" ? <p className="mt-4 text-base text-ink">Saved.</p> : null}
      {query.saved === "deleted" ? <p className="mt-4 text-base text-ink">Account deleted. That phone can sign up again.</p> : null}
      {typeof query.error === "string" ? (
        <p role="alert" className="mt-4 text-base text-danger">
          {query.error}
        </p>
      ) : null}
      <dl className="mt-6 space-y-2 text-base text-ink">
        <div>City: {driver.home_city}</div>
        <div>Areas I cover: {areas || "Not set"}</div>
        <div>Service level: {driver.service_level}</div>
        <div>Services: {(driver.services ?? []).join(", ") || "None"}</div>
        <div>License expires: {driver.license_expires || "Missing"}</div>
        <div>Insurance expires: {driver.insurance_expires || "Missing"}</div>
        <div>Contact consent: {driver.contact_consent_at ? "Yes" : "No"}</div>
        <div>Agreement: {driver.agreement_signed_at ? `Signed ${driver.agreement_signed_at.slice(0, 10)}` : "Not signed"}</div>
        <div>Training: {driver.training_completed_at ? "Complete" : "Not complete"}</div>
        <div>Equipment saved: {driver.kit_saved_at ? "Yes" : "No"}</div>
        <div>
          Payout: {driver.payout_method} {driver.payout_handle}
        </div>
        <div>
          Vehicle: {vehicle ? `${vehicle.type} ${vehicle.year ?? ""} ${vehicle.make ?? ""} ${vehicle.model ?? ""} (${vehicle.plate ?? "no plate"})` : "Missing"}
          {vehicle?.approved ? " · approved" : " · not approved"}
        </div>
        {driver.review_note ? <div>Last note: {driver.review_note}</div> : null}
        {driver.agreement_signature ? <div>Signed: {driver.agreement_signature}</div> : null}
      </dl>
      <div className="mt-4 grid grid-cols-2 gap-3 text-base">
        <DocThumb href={licenseUrl} label="License" status={driver.license_url ? "Uploaded" : "Missing"} />
        <DocThumb href={insuranceUrl} label="Insurance" status={driver.insurance_url ? "Uploaded" : "Missing"} />
        <DocThumb href={vehicleUrl} label="Vehicle" status={vehicle ? "Uploaded" : "Missing"} />
        <DocThumb href={profileUrl} label="Profile" status={profileUrl ? "Uploaded" : "Missing"} />
      </div>
      <form action={requestDocuments} className="mt-8 space-y-3 rounded-3xl bg-paper-raised p-4 ring-1 ring-line">
        <h2 className="font-display text-2xl font-semibold text-ink">Request documents</h2>
        {documentItems.map((item) => (
          <label key={item} className="flex min-h-12 items-center gap-3 capitalize">
            <input type="checkbox" name="item" value={item} />
            {item}
          </label>
        ))}
        <label className="block text-base font-semibold text-ink" htmlFor="request-note">
          Note for the driver
          <textarea id="request-note" name="note" required className="mt-2 min-h-24 w-full rounded-2xl border border-line bg-paper px-4 py-3" />
        </label>
        <input type="hidden" name="driverId" value={id} />
        <button type="submit" className="inline-flex min-h-12 items-center justify-center rounded-full bg-ink px-6 font-semibold text-white">
          Request documents
        </button>
      </form>
      <AccountControls profileId={id} returnTo={`/admin/drivers/${id}`} label="Account restriction" />
      <form action={reviewDriver} className="mt-8 space-y-4">
        <input type="hidden" name="driverId" value={id} />
        <label className="block text-base font-semibold text-ink" htmlFor="note">
          Note
          <textarea
            id="note"
            name="note"
            className="mt-2 min-h-24 w-full rounded-2xl border border-line bg-paper-raised px-4 py-3 text-base"
          />
        </label>
        {!driver.insurance_url || !driver.license_url || !vehicle ? (
          <p className="text-base text-ink">
            Approving with a missing document lets this driver go Online and accept paid jobs. Paid hauling without verified insurance can leave the driver uninsured for hire.
          </p>
        ) : null}
        {driver.insurance_url ? null : <p className="text-base font-semibold text-danger">No insurance on file.</p>}
        {driver.license_url ? null : <p className="text-base font-semibold text-danger">No license on file.</p>}
        {vehicle ? null : <p className="text-base font-semibold text-danger">No vehicle on file.</p>}
        {!driver.insurance_url || !driver.license_url || !vehicle ? (
          <label className="flex min-h-12 items-center gap-3 text-base font-semibold text-ink">
            <input type="checkbox" name="approveAnyway" />
            Approve anyway
          </label>
        ) : null}
        <div className="grid gap-3">
          {actions.map(([decision, label]) => (
            <button
              key={decision}
              type="submit"
              name="decision"
              value={decision}
              className="inline-flex min-h-12 items-center justify-center rounded-full bg-brand px-6 text-base font-semibold text-white"
            >
              {label}
            </button>
          ))}
        </div>
      </form>
    </main>
  );
}

function DocThumb({ href, label, status }: { href: string | null; label: string; status: string }) {
  return (
    <div className="rounded-2xl bg-paper-raised p-3 ring-1 ring-line">
      <p className="font-semibold text-ink">{label}</p>
      <p className="text-sm text-muted">{status}</p>
      {href ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={href} alt="" className="mt-2 aspect-square w-full rounded-xl object-cover" />
      ) : null}
    </div>
  );
}
