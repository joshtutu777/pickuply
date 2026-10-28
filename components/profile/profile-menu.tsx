import Link from "next/link";
import { ModeSwitch } from "@/components/profile/mode-switch";
import { SignOutButton } from "@/components/sign-out-button";
import { formatUsPhone } from "@/lib/phone";
import type { Role } from "@/lib/auth/access";
import { betaMode } from "@/lib/beta";

const row =
  "flex min-h-12 w-full items-center rounded-3xl bg-paper-raised px-4 text-left font-semibold text-ink ring-1 ring-line";

export function ProfileMenu({
  phone,
  role,
  hasDriver,
  area,
  surface,
}: {
  phone: string | null;
  role: Role;
  hasDriver: boolean;
  area?: string | null;
  surface: "customer" | "driver";
}) {
  const shown = phone ? formatUsPhone(phone) : null;
  const driving = role === "driver" || hasDriver;
  return (
    <>
      <p className="mt-2 text-base text-muted">{shown ?? "No phone on file"}</p>
      {area ? <p className="mt-1 text-base text-muted">{area}</p> : null}
      <ul className="mt-6 grid gap-3">
        {role === "admin" ? (
          <li>
            <Link href="/admin" className={row}>
              Admin
            </Link>
          </li>
        ) : null}
        {surface === "driver" ? (
          <li>
            <ModeSwitch mode="customer" label="Switch to customer" />
          </li>
        ) : driving ? (
          <li>
            <ModeSwitch mode="driver" label="Switch to driving" />
          </li>
        ) : (
          <li>
            <ModeSwitch mode="driver" label="Become a driver" />
          </li>
        )}
        <li>
          <Link href={surface === "driver" ? "/driver/notifications" : "/account/notifications"} className={row}>
            Alerts
          </Link>
        </li>
        {surface === "driver" ? (
          <>
            <li>
              <Link href="/driver/areas" className={row}>
                Areas I cover
              </Link>
            </li>
            <li>
              <Link href="/driver/ready/services" className={row}>
                Services
              </Link>
            </li>
            <li>
              <Link href="/driver/ready/equipment" className={row}>
                Equipment
              </Link>
            </li>
          </>
        ) : null}
        {surface === "driver" ? (
          <li>
            <Link href="/driver/earnings" className={row}>
              Earnings and payouts
            </Link>
          </li>
        ) : null}
        {betaMode() ? (
          <li>
            <Link
              href={surface === "driver" ? "/feedback?from=/driver/profile" : "/feedback?from=/account/profile"}
              className={row}
            >
              Send Feedback
            </Link>
          </li>
        ) : null}
        <li>
          <a href="#contact" className={row}>
            Contact preferences
          </a>
        </li>
        {surface === "customer" ? (
          <li>
            <Link href="/account/payments" className={row}>
              Payment methods
            </Link>
          </li>
        ) : null}
        {surface === "customer" ? (
          <li>
            <Link href="/account/jobs#offers" className={row}>
              Offers
            </Link>
          </li>
        ) : null}
        <li>
          <Link href="/help" className={row}>
            Help
          </Link>
        </li>
        <li>
          <Link href="/terms" className={row}>
            Terms
          </Link>
        </li>
        <li>
          <Link href="/privacy" className={row}>
            Privacy
          </Link>
        </li>
      </ul>
      <div className="mt-8 border-t border-line pt-4">
        <p className="text-sm font-semibold text-muted">Account management</p>
        {hasDriver ? (
          <Link href="/account/stop-driving" className="mt-2 flex min-h-12 items-center text-base font-semibold text-ink">
            Stop Driving
          </Link>
        ) : null}
        <Link href="/account/delete" className="mt-2 inline-flex min-h-12 items-center text-sm font-semibold text-danger">
          Delete Account
        </Link>
      </div>
      <div className="mt-6">
        <SignOutButton />
      </div>
    </>
  );
}
