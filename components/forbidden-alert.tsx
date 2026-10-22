import { ACCESS_DENIED_MESSAGE } from "@/lib/auth/access";

export function ForbiddenAlert() {
  return (
    <p
      role="alert"
      className="mt-6 rounded-2xl border border-line bg-paper-raised px-4 py-3 text-base font-medium text-ink"
    >
      {ACCESS_DENIED_MESSAGE}
    </p>
  );
}
