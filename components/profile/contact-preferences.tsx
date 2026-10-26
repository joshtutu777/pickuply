import { saveAlertPreferences } from "@/app/account/notification-actions";
import { formatUsPhone } from "@/lib/phone";

export function ContactPreferences({
  phone,
  email,
  returnTo,
  pushEnabled,
  emailEnabled,
  promotional,
  saved,
  error,
}: {
  phone: string | null;
  email: string | null;
  returnTo: "/account/profile" | "/driver/profile";
  pushEnabled: boolean;
  emailEnabled: boolean;
  promotional: boolean;
  saved: boolean;
  error: boolean;
}) {
  const shown = phone ? formatUsPhone(phone) : null;
  return (
    <section id="contact" className="mt-6 scroll-mt-24 rounded-3xl bg-paper-raised p-4 ring-1 ring-line">
      <h2 className="text-lg font-semibold text-ink">Contact preferences</h2>
      <p className="mt-3 text-base text-ink">
        Phone: {shown ?? "No phone on file"}
      </p>
      <p className="text-base text-muted">Your phone is verified when you sign in with a code. It is not edited here.</p>
      <p className="mt-2 text-base text-ink">Email: {email?.trim() || "No email saved"}</p>
      {saved ? <p className="mt-3 text-base text-ink">Saved.</p> : null}
      {error ? (
        <p role="alert" className="mt-3 text-base text-danger">
          We couldn&apos;t save that.
        </p>
      ) : null}
      <form action={saveAlertPreferences} className="mt-4 space-y-3">
        <input type="hidden" name="returnTo" value={returnTo} />
        <label className="flex min-h-12 items-center gap-3 text-base">
          <input type="checkbox" name="push" defaultChecked={pushEnabled} />
          Alerts on this device
        </label>
        <label className="flex min-h-12 items-center gap-3 text-base">
          <input type="checkbox" name="email" defaultChecked={emailEnabled} />
          Email
        </label>
        <p className="text-base text-muted">Text messages are off until Pickuply&apos;s texting registration is approved.</p>
        <label className="flex min-h-12 items-start gap-3 text-base">
          <input type="checkbox" name="promotional" defaultChecked={promotional} />
          <span>I agree to receive promotional text messages from Pickuply. Message and data rates may apply. Message frequency varies. Reply STOP to opt out.</span>
        </label>
        <button type="submit" className="inline-flex min-h-12 items-center justify-center rounded-full bg-brand px-6 font-semibold text-white">
          Save
        </button>
      </form>
    </section>
  );
}
