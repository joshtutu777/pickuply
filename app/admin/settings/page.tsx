import { BackLink } from "@/components/back-link";
import { Suspense } from "react";
import { saveSettings } from "@/app/admin/requests/actions";
import {
  saveOfferMinimums,
  saveSmsSetting,
  saveSupportContact,
  savePickupLead,
  saveProofLocation,
  saveWavesSetting,
} from "@/app/admin/settings/actions";
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
    platform_bps: 1500,
    platform_min_cents: 0,
    service_bps: 290,
    service_fixed_cents: 30,
    service_fee_bps: 500,
    payment_due_minutes: 30,
    sms_enabled: false,
    support_phone: null,
    support_email: null,
    proof_location_enabled: false,
    waves_enabled: false,
    delivery_offer_min_cents: 3500,
    junk_offer_min_cents: 5000,
    store_offer_min_cents: 3500,
    free_item_offer_min_cents: 3500,
    accept_window_lead_minutes: 60,
    offer_arrival_lead_minutes: 30,
  };

  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-4 py-8">
      <p className="text-sm font-semibold tracking-wide text-brand uppercase">Admin</p>
      <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight text-ink">Settings</h1>
      <p className="mt-3 text-base leading-relaxed text-muted">
        The commission is 15% of the customer offer and comes out of the driver&apos;s side. The customer
        also pays a service fee. The late-cancel fee and the trip fee are off, so new cancellations
        and rejected pickups do not charge them. Stripe&apos;s processing cost stays Pickuply&apos;s expense.
        A change here applies to new offers only.
      </p>
      <BackLink href="/admin" label="Admin" />
      {query.saved === "1" ? <p className="mt-4">Saved.</p> : null}
      {typeof query.error === "string" ? (
        <p role="alert" className="mt-4 text-danger">
          {query.error}
        </p>
      ) : null}
      <form action={saveSettings} className="mt-6 space-y-4">
        <label className="block text-base font-semibold" htmlFor="platformBps">
          Pickuply commission (basis points, 1500 = 15% of the offer)
          <input id="platformBps" name="platformBps" defaultValue={settings.platform_bps} className={controlClass} />
        </label>
        <label className="block text-base font-semibold" htmlFor="platformMin">
          Unused minimum (dollars, keep at 0)
          <input
            id="platformMin"
            name="platformMin"
            defaultValue={(settings.platform_min_cents / 100).toFixed(2)}
            className={controlClass}
          />
        </label>
        <label className="block text-base font-semibold" htmlFor="serviceBps">
          Service fee (basis points, 500 = 5% of the offer)
          <input id="serviceBps" name="serviceBps" defaultValue={settings.service_fee_bps} className={controlClass} />
        </label>
        <input type="hidden" name="serviceFixed" value="0" />
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
      <form action={saveOfferMinimums} className="mt-8 space-y-4 rounded-3xl bg-paper-raised p-4 ring-1 ring-line">
        <h2 className="text-lg font-semibold text-ink">Minimum offer amounts</h2>
        <p className="text-base text-muted">
          A driver cannot submit an offer below these amounts. The customer total is still calculated from the offer.
        </p>
        <label className="block text-base font-semibold" htmlFor="deliveryMin">
          Pickup & Delivery (dollars)
          <input
            id="deliveryMin"
            name="deliveryMin"
            defaultValue={(settings.delivery_offer_min_cents / 100).toFixed(2)}
            className={controlClass}
          />
        </label>
        <label className="block text-base font-semibold" htmlFor="junkMin">
          Junk Removal (dollars)
          <input
            id="junkMin"
            name="junkMin"
            defaultValue={(settings.junk_offer_min_cents / 100).toFixed(2)}
            className={controlClass}
          />
        </label>
        <label className="block text-base font-semibold" htmlFor="storeMin">
          Store Delivery (dollars)
          <input
            id="storeMin"
            name="storeMin"
            defaultValue={(settings.store_offer_min_cents / 100).toFixed(2)}
            className={controlClass}
          />
        </label>
        <label className="block text-base font-semibold" htmlFor="freeItemMin">
          Free-Item Pickups (dollars)
          <input
            id="freeItemMin"
            name="freeItemMin"
            defaultValue={(settings.free_item_offer_min_cents / 100).toFixed(2)}
            className={controlClass}
          />
        </label>
        <button
          type="submit"
          className="inline-flex min-h-12 items-center justify-center rounded-full bg-brand px-6 font-semibold text-white"
        >
          Save minimum offers
        </button>
      </form>
      <form action={savePickupLead} className="mt-8 space-y-4 rounded-3xl bg-paper-raised p-4 ring-1 ring-line">
        <h2 className="text-lg font-semibold text-ink">Pickup timing</h2>
        <p className="text-base text-muted">
          A customer can accept a pickup window only while at least this many minutes remain.
          A driver&apos;s Anytime or ASAP arrival has to be at least this many minutes ahead when the offer is sent.
        </p>
        <label className="block text-base font-semibold" htmlFor="acceptWindowLead">
          Minutes left when a customer accepts a window
          <input
            id="acceptWindowLead"
            name="acceptWindowLead"
            inputMode="numeric"
            defaultValue={settings.accept_window_lead_minutes ?? 60}
            className={controlClass}
          />
        </label>
        <label className="block text-base font-semibold" htmlFor="offerArrivalLead">
          Minutes ahead for a driver&apos;s proposed arrival
          <input
            id="offerArrivalLead"
            name="offerArrivalLead"
            inputMode="numeric"
            defaultValue={settings.offer_arrival_lead_minutes ?? 30}
            className={controlClass}
          />
        </label>
        <button
          type="submit"
          className="inline-flex min-h-12 items-center justify-center rounded-full bg-brand px-6 font-semibold text-white"
        >
          Save pickup timing
        </button>
      </form>
      <form action={saveWavesSetting} className="mt-8 space-y-3 rounded-3xl bg-paper-raised p-4 ring-1 ring-line">
        <h2 className="text-lg font-semibold text-ink">Waves</h2>
        <p className="text-base text-muted">
          Leave this off for the pilot. Every open request stays visible to every eligible driver.
          Turn it on to use the three-wave release.
        </p>
        <label className="flex min-h-12 items-center gap-3 text-base font-semibold" htmlFor="wavesEnabled">
          <input
            id="wavesEnabled"
            name="wavesEnabled"
            type="checkbox"
            defaultChecked={Boolean(settings.waves_enabled)}
          />
          Waves enabled
        </label>
        <button
          type="submit"
          className="inline-flex min-h-12 items-center justify-center rounded-full bg-brand px-6 font-semibold text-white"
        >
          Save waves
        </button>
      </form>
      <form action={saveSmsSetting} className="mt-8 space-y-3 rounded-3xl bg-paper-raised p-4 ring-1 ring-line">
        <h2 className="text-lg font-semibold text-ink">Text messages</h2>
        <p className="text-base text-muted">
          Texting stays off until this box is checked. Leave it off until Twilio approves Pickuply.
        </p>
        <label className="flex min-h-12 items-center gap-3 text-base font-semibold" htmlFor="smsEnabled">
          <input
            id="smsEnabled"
            name="smsEnabled"
            type="checkbox"
            defaultChecked={Boolean(settings.sms_enabled)}
          />
          Allow text message alerts
        </label>
        <button
          type="submit"
          className="inline-flex min-h-12 items-center justify-center rounded-full bg-brand px-6 font-semibold text-white"
        >
          Save text setting
        </button>
      </form>
      <form action={saveSupportContact} className="mt-8 space-y-3 rounded-3xl bg-paper-raised p-4 ring-1 ring-line">
        <h2 className="text-lg font-semibold text-ink">Support contact</h2>
        <p className="text-base text-muted">
          Shown on the support page. Leave blank until you have a number or email.
        </p>
        <label className="block text-base font-semibold" htmlFor="supportPhone">
          Support phone (+1 and 10 digits)
          <input
            id="supportPhone"
            name="supportPhone"
            defaultValue={settings.support_phone ?? ""}
            className={controlClass}
          />
        </label>
        <label className="block text-base font-semibold" htmlFor="supportEmail">
          Support email
          <input
            id="supportEmail"
            name="supportEmail"
            defaultValue={settings.support_email ?? ""}
            className={controlClass}
          />
        </label>
        <button
          type="submit"
          className="inline-flex min-h-12 items-center justify-center rounded-full bg-brand px-6 font-semibold text-white"
        >
          Save support contact
        </button>
      </form>
      <form action={saveProofLocation} className="mt-8 space-y-3 rounded-3xl bg-paper-raised p-4 ring-1 ring-line">
        <h2 className="text-lg font-semibold text-ink">Proof location</h2>
        <p className="text-base text-muted">
          Off by default. When it is on, a driver can choose to share a rounded location. Customers never see it.
        </p>
        <label className="flex min-h-12 items-center gap-3 text-base font-semibold" htmlFor="proofLocation">
          <input
            id="proofLocation"
            name="proofLocation"
            type="checkbox"
            defaultChecked={Boolean(settings.proof_location_enabled)}
          />
          Allow approximate proof location
        </label>
        <button
          type="submit"
          className="inline-flex min-h-12 items-center justify-center rounded-full bg-brand px-6 font-semibold text-white"
        >
          Save location setting
        </button>
      </form>
    </main>
  );
}
