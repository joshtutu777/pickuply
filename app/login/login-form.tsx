"use client";

import { useEffect, useRef, useState } from "react";
import { safeNextParam } from "@/lib/auth/access";
import { mapOtpError, otpErrorCopy } from "@/lib/auth/otp-errors";
import { claimOtpSend, finishOtpSend, type OtpSendGate } from "@/lib/auth/otp-send-gate";
import { SignInSmsNotice, SmsConsent, recordOptionalSmsConsent } from "@/components/sms-consent";
import { codeSentMessage, normalizeUsPhone } from "@/lib/phone";
import { sendSignInCode } from "@/app/login/otp-limit";
import { verifyPhoneCode } from "@/lib/auth/otp-verify-client";

const RESEND_MS = 30_000;

const inputClass =
  "mt-2 min-h-12 w-full rounded-2xl border border-line bg-paper-raised px-4 text-base text-ink";

const primaryButton =
  "inline-flex min-h-12 items-center justify-center rounded-full bg-brand px-6 text-base font-semibold text-white transition-colors hover:bg-brand-dark disabled:opacity-60";

const secondaryButton =
  "inline-flex min-h-12 items-center justify-center rounded-full border border-line bg-paper-raised px-6 text-base font-semibold text-ink transition-colors hover:border-brand disabled:opacity-60";

function authConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}

export function LoginForm({
  next,
  intent,
  notice,
}: {
  next: string;
  intent: string;
  notice: string;
}) {
  const safeNext = safeNextParam(next) ?? "";
  const driver = intent === "driver";
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [phone, setPhone] = useState("");
  const [sentPhone, setSentPhone] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [cooling, setCooling] = useState(false);
  const [smsOptIn, setSmsOptIn] = useState(false);
  const [signedInTo, setSignedInTo] = useState("");
  const codeRef = useRef<HTMLInputElement>(null);
  const sendGate = useRef<OtpSendGate>({ inFlight: false, coolingUntil: 0 });
  const configured = authConfigured();
  const sentCopy = sentPhone ? codeSentMessage(sentPhone) : null;

  useEffect(() => {
    if (step !== "code") return;
    codeRef.current?.focus();
  }, [step]);

  useEffect(() => {
    if (!cooling) return;
    const timer = window.setTimeout(() => setCooling(false), RESEND_MS);
    return () => window.clearTimeout(timer);
  }, [cooling]);

  async function sendCode(target: string) {
    const normalized = normalizeUsPhone(target);
    if (!normalized) {
      setError(otpErrorCopy.invalidNumber);
      setStep("phone");
      return;
    }
    if (!configured) {
      setError("Phone sign-in is not available right now.");
      return;
    }
    if (cooling) return;
    // The gate flips before any wait, so a second click cannot send another text.
    if (!claimOtpSend(sendGate.current, Date.now())) return;

    setPending(true);
    setError("");
    let sent = false;
    try {
      const sendError = await sendSignInCode(normalized);
      if (sendError) {
        setError(sendError);
        return;
      }
      sent = true;
      setSentPhone(normalized);
      setStep("code");
      setCooling(true);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "";
      const name = caught instanceof Error ? caught.name : "";
      setError(mapOtpError({ message, name }, "send"));
    } finally {
      finishOtpSend(sendGate.current, sent ? "sent" : "failed", Date.now(), RESEND_MS);
      setPending(false);
    }
  }

  async function verifyCode() {
    if (!/^\d{6}$/.test(code)) {
      setError("Enter the 6-digit code.");
      return;
    }
    setPending(true);
    setError("");
    try {
      const verifyError = await verifyPhoneCode(sentPhone, code);
      if (verifyError) {
        setError(verifyError);
        setPending(false);
        return;
      }
      const params = new URLSearchParams();
      if (safeNext) params.set("next", safeNext);
      if (driver) params.set("intent", "driver");
      const query = params.toString();
      const destination = query ? `/auth/continue?${query}` : "/auth/continue";
      if (smsOptIn) {
        const consentError = await recordOptionalSmsConsent("login");
        if (consentError) {
          setSignedInTo(destination);
          setError("We couldn't save your text-message choice. Optional texts stay off.");
          setPending(false);
          return;
        }
      }
      window.location.assign(destination);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "";
      const name = caught instanceof Error ? caught.name : "";
      setError(mapOtpError({ message, name }, "verify"));
      setPending(false);
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center px-5 py-14">
      <p className="text-sm font-semibold tracking-wide text-brand uppercase">Account</p>
      <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight text-ink">
        {driver ? "Sign up to drive with Pickuply" : "Log in or sign up"}
      </h1>
      <p className="mt-4 text-lg leading-relaxed text-muted">
        {driver
          ? "Verify your phone to start your driver application. It takes about 5 minutes."
          : "Enter your mobile number and we'll text you a 6-digit code."}
      </p>
      {notice ? (
        <p role="alert" className="mt-6 text-base font-medium text-danger">
          {notice}
        </p>
      ) : null}
      {!configured ? (
        <p role="alert" className="mt-6 text-base font-medium text-danger">
          Phone sign-in is not available right now.
        </p>
      ) : null}

      {step === "phone" ? (
        <form
          className="mt-8 flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void sendCode(phone);
          }}
        >
          <label className="block" htmlFor="phone">
            <span className="text-base font-semibold text-ink">Mobile number</span>
            <input
              id="phone"
              name="phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              required
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "phone-error" : undefined}
              className={inputClass}
              disabled={!configured || pending || cooling}
            />
          </label>
          <SmsConsent audience={driver ? "driver" : "customer"} checked={smsOptIn} onChange={setSmsOptIn} />
          {error ? (
            <p id="phone-error" role="alert" className="text-sm font-medium text-danger">
              {error}
            </p>
          ) : null}
          <button type="submit" className={primaryButton} disabled={!configured || pending || cooling}>
            Text me a code
          </button>
          <SignInSmsNotice />
          {cooling ? (
            <p className="text-sm leading-relaxed text-muted">You can resend a code in 30 seconds.</p>
          ) : null}
        </form>
      ) : (
        <form
          className="mt-8 flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void verifyCode();
          }}
        >
          <p className="text-lg leading-relaxed text-ink">{sentCopy}</p>
          <label className="block" htmlFor="code">
            <span className="text-base font-semibold text-ink">6-digit code</span>
            <input
              ref={codeRef}
              id="code"
              name="code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              required
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "code-error" : undefined}
              className={inputClass}
              disabled={pending}
            />
          </label>
          <SmsConsent audience={driver ? "driver" : "customer"} checked={smsOptIn} onChange={setSmsOptIn} />
          {error ? (
            <p id="code-error" role="alert" className="text-sm font-medium text-danger">
              {error}
            </p>
          ) : null}
          {signedInTo ? (
            <a href={signedInTo} className="text-base font-semibold text-brand underline underline-offset-4">
              Continue without optional texts
            </a>
          ) : null}
          <button type="submit" className={primaryButton} disabled={pending}>
            Verify and continue
          </button>
          <SignInSmsNotice />
          <button
            type="button"
            className={secondaryButton}
            disabled={pending || cooling}
            onClick={() => void sendCode(sentPhone)}
          >
            Resend code
          </button>
          {cooling ? (
            <p className="text-sm leading-relaxed text-muted">You can resend a code in 30 seconds.</p>
          ) : null}
          <button
            type="button"
            className="min-h-12 self-start text-base font-semibold text-brand underline-offset-4 hover:underline"
            onClick={() => {
              setStep("phone");
              setCode("");
              setError("");
            }}
          >
            Use a different number
          </button>
        </form>
      )}
    </main>
  );
}
