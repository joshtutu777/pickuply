"use client";

import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

export const smsConsentVersion = "2026-10-23";

export const customerSmsConsent =
  "I agree to receive automated text messages from Pickuply about my requests, driver offers, bookings, and deliveries. Consent is not required to register. Message frequency varies. Message and data rates may apply. Reply STOP to opt out or HELP for assistance.";

export const driverSmsConsent =
  "I agree to receive automated text messages from Pickuply about my driver application, available jobs, offers, and assignments. Consent is not required to apply. Message frequency varies. Message and data rates may apply. Reply STOP to opt out or HELP for assistance.";

export function SmsConsent({
  checked,
  onChange,
  audience,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  audience: "customer" | "driver";
}) {
  return (
    <section
      className="space-y-3"
      aria-labelledby="sms-consent-heading"
      data-disclosure-version={smsConsentVersion}
    >
      <h2 id="sms-consent-heading" className="text-base font-semibold text-ink">
        Optional text messages
      </h2>
      <p className="text-sm leading-relaxed text-muted">
        The sign-in code is separate. This box is only for optional texts. Pickuply is the sender.{" "}
        <Link href="/privacy" className="font-semibold text-brand underline underline-offset-4">
          Privacy Policy
        </Link>{" "}
        and{" "}
        <Link href="/terms" className="font-semibold text-brand underline underline-offset-4">
          Terms of Service
        </Link>
        .
      </p>
      <label className="flex min-h-12 items-start gap-3 text-base leading-relaxed text-ink">
        <input
          className="mt-1 size-5"
          type="checkbox"
          name="smsConsent"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span>{audience === "driver" ? driverSmsConsent : customerSmsConsent}</span>
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
