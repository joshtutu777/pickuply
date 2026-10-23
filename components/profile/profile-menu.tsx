import Link from "next/link";
import { ModeSwitch } from "@/components/profile/mode-switch";
import { SignOutButton } from "@/components/sign-out-button";
import { maskUsPhone } from "@/lib/phone";
import type { Role } from "@/lib/auth/access";

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
  const masked = phone ? maskUsPhone(phone) : null;
  const driving = role === "driver" || hasDriver;
  return (
    <>
      <p className="mt-2 text-base text-muted">{masked ?? "Phone on file"}</p>
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
          <li>
            <Link href="/driver/earnings" className={row}>
              Earnings and payouts
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
      <div className="mt-6">
        <SignOutButton />
      </div>
    </>
  );
}
