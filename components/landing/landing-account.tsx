import Link from "next/link";
import { SignOutButton } from "@/components/sign-out-button";
import { homeAccount } from "@/lib/auth/home-account";
import { getOptionalSession } from "@/lib/auth/session";

const control =
  "inline-flex min-h-12 items-center rounded-full border-[1.5px] border-[#CFC7B8] bg-[#FFFDF8] px-3 py-2 text-[13px] font-semibold text-[#14211B] sm:px-[18px] sm:py-2.5 sm:text-base";

const textLink = "inline-flex min-h-12 items-center px-2 py-2 text-[13px] font-semibold text-[#17573E] sm:px-3 sm:text-base";

export function LandingAccountFallback() {
  return <span className="inline-flex min-h-12 min-w-24" aria-hidden="true" />;
}

export async function LandingAccount() {
  const session = await getOptionalSession();
  const account = homeAccount({
    signedIn: Boolean(session) && !session?.deleted,
    role: session?.role ?? null,
    firstName: session?.firstName ?? null,
    registrationComplete: session?.registrationComplete ?? false,
  });

  if (account.kind === "signed-out") {
    return (
      <Link href="/login" className={control}>
        Sign in
      </Link>
    );
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {account.firstName ? <span className="px-2 text-[13px] font-semibold text-[#14211B] sm:text-base">{account.firstName}</span> : null}
      {account.kind === "finish-profile" ? (
        <Link href="/login/name" className={control}>
          Complete your profile
        </Link>
      ) : null}
      {account.kind === "customer" ? (
        <>
          <Link href="/account" className={control}>
            My Account
          </Link>
          <Link href="/account/jobs" className={textLink}>
            My Requests
          </Link>
        </>
      ) : null}
      {account.kind === "driver" ? (
        <Link href="/driver" className={control}>
          Driver home
        </Link>
      ) : null}
      {account.kind === "admin" ? (
        <Link href="/admin" className={control}>
          Admin
        </Link>
      ) : null}
      <SignOutButton className="border-[#CFC7B8] bg-[#FFFDF8] px-3 text-[13px] sm:px-[18px] sm:text-base" />
    </span>
  );
}
