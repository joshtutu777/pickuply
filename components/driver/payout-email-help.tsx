import Link from "next/link";
import { PAYOUT_EMAIL_REQUIRED } from "@/lib/payments/payout-contact-email";

/** Link to the email field when payout setup is waiting on an address. */
export function PayoutEmailHelp({ message }: { message: string }) {
  if (message !== PAYOUT_EMAIL_REQUIRED) return null;
  return (
    <Link href="/driver/profile#email" className="mt-2 inline-flex min-h-12 items-center font-semibold text-brand underline">
      Add your email
    </Link>
  );
}
