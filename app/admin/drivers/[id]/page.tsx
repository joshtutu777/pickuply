import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { reviewDriver } from "@/app/admin/drivers/actions";
import { LoadingMain } from "@/components/loading-main";
import { requireAdmin } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

const actions = [
  ["approve_new", "Approve as new"],
  ["approve_active", "Approve as active"],
  ["request_changes", "Request changes"],
  ["decline", "Decline"],
  ["pause", "Pause"],
  ["remove", "Remove"],
] as const;

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
  const [{ data: profile }, { data: vehicle }] = await Promise.all([
    supabase.from("profiles").select("full_name, role, photo_url").eq("id", id).maybeSingle(),
    supabase
      .from("vehicles")
      .select("type, make, model, year, plate, cargo_length_in, photo_url, approved")
      .eq("driver_id", id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  const [licenseUrl, insuranceUrl, profileUrl, vehicleUrl] = await Promise.all([
    signed(driver.license_url),
    signed(driver.insurance_url),
    signed(profile?.photo_url ?? null),
    signed(vehicle?.photo_url ?? null),
  ]);

  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-4 py-8">
      <p className="text-sm font-semibold tracking-wide text-brand uppercase">Admin</p>
      <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight text-ink">
        {profile?.full_name || "Applicant"}
      </h1>
      <p className="mt-2 text-base text-muted">
        {driver.status.replaceAll("_", " ")} · role {profile?.role}
      </p>
      <Link href="/admin/drivers" className="mt-4 inline-flex min-h-12 items-center font-semibold text-brand">
        All drivers
      </Link>
      {query.saved === "1" ? <p className="mt-4 text-base text-ink">Saved.</p> : null}
      {typeof query.error === "string" ? (
        <p role="alert" className="mt-4 text-base text-danger">
          {query.error}
        </p>
      ) : null}
      <dl className="mt-6 space-y-2 text-base text-ink">
        <div>City: {driver.home_city}</div>
        <div>Service level: {driver.service_level}</div>
        <div>Services: {(driver.services ?? []).join(", ") || "None"}</div>
        <div>License expires: {driver.license_expires || "Missing"}</div>
        <div>Insurance expires: {driver.insurance_expires || "Missing"}</div>
        <div>
          Payout: {driver.payout_method} {driver.payout_handle}
        </div>
        <div>
          Vehicle: {vehicle ? `${vehicle.year} ${vehicle.make} ${vehicle.model} (${vehicle.plate})` : "Missing"}
          {vehicle?.approved ? " · approved" : ""}
        </div>
        {driver.review_note ? <div>Last note: {driver.review_note}</div> : null}
        {driver.agreement_signature ? <div>Signed: {driver.agreement_signature}</div> : null}
      </dl>
      <div className="mt-4 space-y-2 text-base">
        {profileUrl ? <DocLink href={profileUrl} label="Profile photo" /> : null}
        {licenseUrl ? <DocLink href={licenseUrl} label="License" /> : null}
        {insuranceUrl ? <DocLink href={insuranceUrl} label="Insurance" /> : null}
        {vehicleUrl ? <DocLink href={vehicleUrl} label="Vehicle photo" /> : null}
      </div>
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

function DocLink({ href, label }: { href: string; label: string }) {
  return (
    <a className="block font-semibold text-brand" href={href}>
      {label}
    </a>
  );
}
