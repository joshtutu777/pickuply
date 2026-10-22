import Link from "next/link";
import { Suspense } from "react";
import { saveSettings } from "@/app/admin/requests/actions";
import { LoadingMain } from "@/components/loading-main";
import { requireAdmin } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

const controlClass =
  "mt-2 min-h-12 w-full rounded-2xl border border-line bg-paper-raised px-4 text-base text-ink";

export default function SettingsPage({ searchParams }: PageProps<"/admin/settings">) {
  return (
    <Suspense fallback={<LoadingMain />}>
      <SettingsContent searchParams={searchParams} />
    </Suspense>
  );
}

async function SettingsContent({
  searchParams,
}: {
  searchParams: PageProps<"/admin/settings">["searchParams"];
}) {
  await requireAdmin("/admin/settings");
  const query = await searchParams;
  const supabase = await createClient();
  const { data } = await supabase.from("platform_settings").select("*").eq("id", 1).maybeSingle();
  const settings = data ?? {
    platform_bps: 1000,
    platform_min_cents: 1000,
    service_bps: 290,
    service_fixed_cents: 30,
    payment_due_minutes: 30,
  };

  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-4 py-8">
      <p className="text-sm font-semibold tracking-wide text-brand uppercase">Admin</p>
      <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight text-ink">Settings</h1>
      <p className="mt-3 text-base leading-relaxed text-muted">
        The service fee covers card processing. The wording and card-surcharge rules need a review
        before launch.
      </p>
      <Link href="/admin" className="mt-4 inline-flex min-h-12 items-center font-semibold text-brand">
        Back to requests
      </Link>
      {query.saved === "1" ? <p className="mt-4">Saved.</p> : null}
      {typeof query.error === "string" ? (
        <p role="alert" className="mt-4 text-danger">
          {query.error}
        </p>
      ) : null}
      <form action={saveSettings} className="mt-6 space-y-4">
        <label className="block text-base font-semibold" htmlFor="platformBps">
          Platform fee (basis points, 1000 = 10%)
          <input id="platformBps" name="platformBps" defaultValue={settings.platform_bps} className={controlClass} />
        </label>
        <label className="block text-base font-semibold" htmlFor="platformMin">
          Platform minimum (dollars)
          <input
            id="platformMin"
            name="platformMin"
            defaultValue={(settings.platform_min_cents / 100).toFixed(2)}
            className={controlClass}
          />
        </label>
        <label className="block text-base font-semibold" htmlFor="serviceBps">
          Service fee percent (basis points, 290 = 2.9%)
          <input id="serviceBps" name="serviceBps" defaultValue={settings.service_bps} className={controlClass} />
        </label>
        <label className="block text-base font-semibold" htmlFor="serviceFixed">
          Service fee fixed amount (dollars)
          <input
            id="serviceFixed"
            name="serviceFixed"
            defaultValue={(settings.service_fixed_cents / 100).toFixed(2)}
            className={controlClass}
          />
        </label>
        <label className="block text-base font-semibold" htmlFor="paymentDueMinutes">
          Minutes to pay after a driver is confirmed
          <input
            id="paymentDueMinutes"
            name="paymentDueMinutes"
            defaultValue={settings.payment_due_minutes}
            className={controlClass}
          />
        </label>
        <button
          type="submit"
          className="inline-flex min-h-12 w-full items-center justify-center rounded-full bg-brand font-semibold text-white"
        >
          Save settings
        </button>
      </form>
    </main>
  );
}
