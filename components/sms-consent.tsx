"use client";

import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

export const smsConsentVersion = "2026-10-22";

export const smsConsentDisclosure =
  "Pickuply uses SMS to send verification codes when you sign in. You may also choose to receive booking updates, driver notifications, payment reminders, and service-related text messages. Message frequency varies. Message and data rates may apply. Reply STOP to opt out or HELP for assistance. Consent to optional messages is not required to use Pickuply.";

export function SmsConsent({
  checked,
  onChange,
  showDisclosure = true,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  showDisclosure?: boolean;
}) {
  return (
    <section
      className="space-y-3"
      aria-labelledby="sms-consent-heading"
      data-disclosure-version={smsConsentVersion}
    >
      <h2 id="sms-consent-heading" className="text-base font-semibold text-ink">
        Text messages
      </h2>
      {showDisclosure ? (
        <>
          <p className="text-sm leading-relaxed text-muted">{smsConsentDisclosure}</p>
          <p className="text-sm leading-relaxed text-muted">
            <Link href="/privacy" className="font-semibold text-brand underline underline-offset-4">
              Privacy Policy
            </Link>{" "}
            and{" "}
            <Link href="/terms" className="font-semibold text-brand underline underline-offset-4">
              Terms of Service
            </Link>
          </p>
        </>
      ) : null}
      <label className="flex min-h-12 items-start gap-3 text-base leading-relaxed text-ink">
        <input
          className="mt-1"
          type="checkbox"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
        />
        I agree to receive SMS booking and service notifications from Pickuply.
      </label>
    </section>
  );
}

export function SignInSmsNotice() {
  return (
    <p className="text-sm leading-relaxed text-muted">
      We&apos;ll text you a sign-in code. Message and data rates may apply. Reply STOP to opt out.{" "}
      <Link href="/terms" className="font-semibold text-brand underline underline-offset-4">
        SMS terms
      </Link>
      {" and "}
      <Link href="/privacy" className="font-semibold text-brand underline underline-offset-4">
        Privacy Policy
      </Link>
      .
    </p>
  );
}

export async function recordOptionalSmsConsent(source: "login" | "driver_onboarding") {
  const { error } = await createClient().rpc("record_sms_consent", { consent_source: source });
  return error;
}
