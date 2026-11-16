import { ShieldCheck } from "lucide-react";

/**
 * Customer-facing hold explanation. The card is authorized at booking checkout,
 * not when a driver is chosen. Capture is after delivery confirmation, or 24
 * hours later if the customer does not confirm.
 */
export function PaymentProtection({ place }: { place: "home" | "checkout" }) {
  const home = place === "home";
  const Heading = home ? "h2" : "h3";
  return (
    <section
      aria-label="Payment protection"
      className={
        home
          ? "border-y border-[#D5E6DC] bg-[#E3F0E8]"
          : "rounded-2xl bg-brand-soft p-4 ring-1 ring-brand/15"
      }
    >
      <div
        className={
          home
            ? "mx-auto flex max-w-[1160px] items-start gap-4 px-6 py-6 sm:items-center sm:gap-5 sm:py-7"
            : "flex items-start gap-3"
        }
      >
        <span
          className={
            home
              ? "flex size-12 shrink-0 items-center justify-center rounded-2xl bg-[#17573E] text-[#FFFDF8] sm:size-14"
              : "flex size-11 shrink-0 items-center justify-center rounded-2xl bg-brand text-white"
          }
          aria-hidden="true"
        >
          <ShieldCheck className={home ? "size-7" : "size-6"} strokeWidth={2.2} />
        </span>
        <div className="min-w-0">
          <Heading
            className={
              home
                ? "font-display text-[26px] leading-tight font-semibold text-[#17573E] sm:text-[32px]"
                : "text-lg font-semibold text-brand"
            }
          >
            Your Payment Is Protected
          </Heading>
          <p
            className={
              home
                ? "mt-1.5 text-lg leading-snug font-medium text-[#14211B] sm:text-xl"
                : "mt-1 text-base leading-snug font-medium text-ink"
            }
          >
            Your card is only held, not charged. You pay after your items are delivered.
          </p>
          <p className={home ? "mt-1.5 text-[15px] leading-relaxed text-[#46544C] sm:text-base" : "mt-1 text-sm leading-relaxed text-muted"}>
            Secure payments powered by Stripe.
          </p>
          {home ? null : (
            <p className="mt-1 text-sm leading-relaxed text-muted">
              Your card is securely authorized when you confirm your booking. Your pickup charge is collected after delivery, either when you confirm completion or automatically after 24 hours.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
