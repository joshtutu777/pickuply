import Link from "next/link";
import { markAlertsRead, saveAlertPreferences } from "@/app/account/notification-actions";
import { BackLink } from "@/components/back-link";
import { EnablePush } from "@/components/notifications/enable-push";
import { AppBadge } from "@/components/pwa/app-badge";
import { HomeScreenHint } from "@/components/notifications/home-screen-hint";
import { requireSignedIn } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export async function AlertCenter({
  path,
  saved,
  error,
  backHref,
  backLabel,
}: {
  path: string;
  saved: boolean;
  error: boolean;
  backHref: string;
  backLabel: string;
}) {
  await requireSignedIn(path);
  const supabase = await createClient();
  const [{ data: alerts, error: alertError }, { data: prefs }] = await Promise.all([
    supabase
      .from("notifications")
      .select("id, title, body, href, read_at, created_at")
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("notification_preferences")
      .select("push_enabled, email_enabled, home_screen_hint_dismissed, promotional_sms")
      .maybeSingle(),
  ]);
  const unread = (alerts ?? []).some((alert) => !alert.read_at);

  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-4 py-8">
      <BackLink href={backHref} label={backLabel} />
      <p className="text-sm font-semibold tracking-wide text-brand uppercase">Alerts</p>
      <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight text-ink">Your alerts</h1>
      <AppBadge count={(alerts ?? []).filter((alert) => !alert.read_at).length} />
      <HomeScreenHint dismissed={Boolean(prefs?.home_screen_hint_dismissed)} />
      <EnablePush publicKey={process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? null} />
      {saved ? <p className="mt-4 text-base text-ink">Saved.</p> : null}
      {error ? (
        <p role="alert" className="mt-4 text-base text-danger">
          We couldn&apos;t save that.
        </p>
      ) : null}
      <form action={saveAlertPreferences} className="mt-6 space-y-3 rounded-3xl bg-paper-raised p-4 ring-1 ring-line">
        <h2 className="text-lg font-semibold text-ink">How we reach you</h2>
        <label className="flex min-h-12 items-center gap-3 text-base">
          <input type="checkbox" name="push" defaultChecked={prefs?.push_enabled ?? true} />
          Alerts on this device
        </label>
        <label className="flex min-h-12 items-center gap-3 text-base">
          <input type="checkbox" name="email" defaultChecked={prefs?.email_enabled ?? true} />
          Email
        </label>
        <p className="text-base text-muted">
          Text messages are off until Pickuply&apos;s texting registration is approved.
        </p>
        <label className="flex min-h-12 items-start gap-3 text-base">
          <input type="checkbox" name="promotional" defaultChecked={Boolean(prefs?.promotional_sms)} />
          <span>I agree to receive promotional text messages from Pickuply. Message and data rates may apply. Message frequency varies. Reply STOP to opt out.</span>
        </label>
        <button
          type="submit"
          className="inline-flex min-h-12 items-center justify-center rounded-full bg-brand px-6 font-semibold text-white"
        >
          Save
        </button>
      </form>
      {alertError ? (
        <p role="alert" className="mt-6 text-lg text-danger">
          We couldn&apos;t load your alerts. Try again.
        </p>
      ) : (alerts ?? []).length === 0 ? (
        <p className="mt-6 text-lg text-muted">No alerts yet.</p>
      ) : (
        <>
          {unread ? (
            <form action={markAlertsRead} className="mt-6">
              <button type="submit" className="inline-flex min-h-12 items-center font-semibold text-brand">
                Mark all read
              </button>
            </form>
          ) : null}
          <ul className="mt-4 grid gap-3">
            {(alerts ?? []).map((alert) => (
              <li key={alert.id} className="rounded-3xl bg-paper-raised p-4 ring-1 ring-line">
                <Link href={alert.href} className="block min-h-12">
                  <p className="text-lg font-semibold text-ink">
                    {alert.read_at ? alert.title : `New · ${alert.title}`}
                  </p>
                  <p className="mt-1 text-base text-ink">{alert.body}</p>
                  <p className="mt-1 text-sm text-muted">{new Date(alert.created_at).toLocaleString()}</p>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </main>
  );
}
