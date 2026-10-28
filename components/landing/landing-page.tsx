import Image from "next/image";
import Link from "next/link";
import { CookieSettingsLink } from "@/components/analytics/cookie-settings-link";
import { BetaBadge } from "@/components/beta-badge";
import { InstallButton } from "@/components/pwa/install-button";
import type { ReactNode } from "react";

const services = [
  {
    href: "/request?service=delivery",
    image: "/images/landing/used-couch.svg",
    alt: "Gently used couch in a lived-in room",
    title: "Pickup & Delivery",
    text: "Facebook Marketplace finds, yard-sale buys, and single big items.",
    icon: "truck",
  },
  {
    href: "/request?service=free_item",
    image: "/images/landing/curbside-free.svg",
    alt: "Secondhand chair and dresser ready for free pickup",
    title: "Free-Item Pickups",
    text: "Grab free furniture from the curb or a group post before someone else does.",
    icon: "gift",
  },
  {
    href: "/request?service=construction",
    image: "/images/landing/store-pickup.svg",
    alt: "Appliance and flat-packed supplies awaiting store pickup",
    title: "Store Pickup & Delivery",
    text: "Lumber, flooring, appliances, and flat-packs from home and building stores.",
    icon: "bag",
  },
  {
    href: "/request?service=junk",
    image: "/images/landing/junk-hauling.svg",
    alt: "Old furniture and yard debris ready for hauling",
    title: "Junk Removal & Hauling",
    text: "Old furniture, junk, and yard debris. Send a photo and get offers.",
    icon: "trash",
  },
] as const;

export function LandingPage({ blog = null }: { blog?: ReactNode }) {
  return (
    <div className="bg-[#F4F1EB] text-[#14211B]">
      <header className="border-b border-[#E4DED2] bg-[#FFFDF8]">
        <div className="mx-auto flex max-w-[1160px] flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6 sm:py-4">
          <Link href="#top" className="flex items-center gap-2.5 text-[#14211B]">
            <span className="flex size-9 items-center justify-center rounded-[10px] bg-[#17573E] font-display text-xl font-bold text-[#FFFDF8]">
              P
            </span>
            <span className="font-display text-2xl font-semibold">Pickuply</span>
            <BetaBadge />
          </Link>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Link
              href="/signup"
              className="inline-flex min-h-12 items-center rounded-full bg-[#17573E] px-4 text-base font-semibold text-[#FFFDF8]"
            >
              Sign up
            </Link>
            <Link
              href="/login"
              className="inline-flex min-h-12 items-center rounded-full border-[1.5px] border-[#CFC7B8] bg-[#FFFDF8] px-4 text-base font-semibold text-[#14211B]"
            >
              Sign in
            </Link>
            <Link
              href="/drive"
              className="inline-flex min-h-12 items-center rounded-full border-[1.5px] border-[#CFC7B8] bg-[#FFFDF8] px-4 text-base font-semibold text-[#14211B]"
            >
              Drive with us
            </Link>
          </div>
          <nav aria-label="Main" className="flex w-full flex-wrap items-center gap-0 sm:gap-2">
            <InstallButton tone="landing" />
            <Link href="#how" className="px-2 py-2 text-[13px] font-medium text-[#14211B] sm:px-3 sm:py-2.5 sm:text-base">
              How it works
            </Link>
            <Link href="#services" className="px-2 py-2 text-[13px] font-medium text-[#14211B] sm:px-3 sm:py-2.5 sm:text-base">
              What we pick up
            </Link>
            <Link href="/contact" className="px-2 py-2 text-[13px] font-medium text-[#14211B] sm:px-3 sm:py-2.5 sm:text-base">
              Contact
            </Link>
            <Link href="/blog" className="px-2 py-2 text-[13px] font-medium text-[#14211B] sm:px-3 sm:py-2.5 sm:text-base">
              Blog
            </Link>
            <Link href="/drive" className="px-2 py-2 text-[13px] font-medium text-[#14211B] sm:px-3 sm:py-2.5 sm:text-base">
              Drive with us
            </Link>
          </nav>
        </div>
      </header>

      <main>
        <section id="top" className="mx-auto flex max-w-[1160px] flex-wrap items-center gap-[30px] px-6 pt-[38px] pb-10 sm:gap-14 sm:pt-[72px] sm:pb-14">
          <div className="flex min-w-0 flex-[1_1_440px] flex-col gap-[22px]">
            <span className="self-start rounded-full bg-[#E3F0E8] px-3.5 py-1.5 text-sm font-semibold text-[#17573E]">
              Early access · Serving Georgia
            </span>
            <h1 className="font-display text-[clamp(40px,10vw,60px)] leading-[1.04] font-semibold tracking-[-0.02em] sm:text-[64px]">
              Say yes to the deal. We&apos;ll do the rest.
            </h1>
            <p className="text-[22px] font-medium">Found it. Bought it. Can&apos;t pick it up? Post it.</p>
            <p className="max-w-[520px] text-lg text-[#46544C]">
              Local drivers with the right vehicle pick up your Marketplace finds, free items, and store purchases — and bring them home before you lose the deal.
            </p>
            <div className="flex flex-wrap gap-3 pt-1.5">
              <Link href="/request" className="inline-flex items-center gap-2.5 rounded-full bg-[#17573E] px-[26px] py-4 text-lg font-semibold text-[#FFFDF8]">
                Post a pickup
                <Arrow />
              </Link>
              <Link href="/drive" className="inline-flex items-center rounded-full border-[1.5px] border-[#CFC7B8] bg-[#FFFDF8] px-[26px] py-4 text-lg font-semibold text-[#14211B]">
                Drive with us
              </Link>
            </div>
            <p className="flex items-center gap-2 text-[15px] text-[#46544C]">
              <CardIcon />
              Your card is charged only after delivery.
            </p>
          </div>

          <div className="flex min-w-0 flex-[1_1_380px] justify-center">
            <div className="flex w-full max-w-[420px] flex-col gap-4 rounded-[28px] border border-[#E4DED2] bg-[#FFFDF8] p-[22px] shadow-[0_24px_60px_rgba(20,33,27,0.10)]">
              <div className="flex items-center justify-between">
                <span className="text-[13px] font-semibold tracking-[0.06em] text-[#46544C] uppercase">Example request</span>
                <span className="rounded-full bg-[#FBEBD6] px-2.5 py-1 text-[13px] font-semibold text-[#8A4B12]">Seller: pick up by 7 PM</span>
              </div>
              <div className="flex items-center gap-3.5">
                <div className="flex size-[88px] shrink-0 items-center justify-center rounded-[18px] bg-[#EDE6D8]" role="img" aria-label="Illustration of an oak dresser">
                  <svg width="62" height="62" viewBox="0 0 60 60" aria-hidden="true">
                    <rect x="9" y="8" width="42" height="40" rx="4" fill="#C98B4F" />
                    <rect x="7" y="6" width="46" height="5" rx="2" fill="#A8713D" />
                    <rect x="13" y="15" width="34" height="9" rx="2" fill="#D9A066" />
                    <rect x="13" y="27" width="34" height="9" rx="2" fill="#D9A066" />
                    <rect x="13" y="39" width="34" height="6" rx="2" fill="#D9A066" />
                    <circle cx="30" cy="19.5" r="1.6" fill="#6B4423" />
                    <circle cx="30" cy="31.5" r="1.6" fill="#6B4423" />
                    <circle cx="30" cy="42" r="1.4" fill="#6B4423" />
                    <rect x="12" y="48" width="4" height="5" rx="1" fill="#6B4423" />
                    <rect x="44" y="48" width="4" height="5" rx="1" fill="#6B4423" />
                  </svg>
                </div>
                <div className="flex min-w-0 flex-col gap-1">
                  <span className="font-display text-[21px] font-semibold">Oak dresser</span>
                  <span className="text-[15px] text-[#46544C]">Facebook Marketplace find</span>
                  <span className="flex items-center gap-1.5 text-sm text-[#46544C]">
                    <ClockIcon />
                    Today · 5–7 PM
                  </span>
                </div>
              </div>
              <div className="flex flex-col gap-2 rounded-[18px] bg-[#F4F1EB] px-4 py-3.5">
                <div className="flex items-center gap-2.5 text-[15px]">
                  <span className="size-2.5 shrink-0 rounded-full bg-[#17573E]" />
                  Pickup · Smyrna, GA
                </div>
                <div className="ml-1 h-3.5 border-l-2 border-dashed border-[#A8B5AD]" />
                <div className="flex items-center gap-2.5 text-[15px]">
                  <span className="size-2.5 shrink-0 rounded-[3px] bg-[#14211B]" />
                  Drop-off · Austell, GA
                </div>
              </div>
              <div className="flex items-baseline justify-between">
                <span className="font-semibold">Drivers sent offers</span>
                <span className="text-sm text-[#46544C]">You choose</span>
              </div>
              <div className="flex flex-col gap-2.5">
                <div className="flex items-center gap-3 rounded-2xl border-[1.5px] border-[#17573E] bg-[#FFFDF8] px-3.5 py-3">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[#E3F0E8] font-bold text-[#17573E]">M</span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="font-semibold">Marcus</span>
                    <span className="text-sm text-[#46544C]">Pickup truck · can load</span>
                  </span>
                  <span className="font-bold">[TOTAL]</span>
                  <span className="rounded-full bg-[#17573E] px-3.5 py-2 text-sm font-semibold text-[#FFFDF8]">Choose</span>
                </div>
                <div className="flex items-center gap-3 rounded-2xl border border-[#E4DED2] px-3.5 py-3">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[#EDE6D8] font-bold text-[#46544C]">T</span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="font-semibold">Tanya</span>
                    <span className="text-sm text-[#46544C]">Cargo van · 2 helpers</span>
                  </span>
                  <span className="font-bold">[TOTAL]</span>
                  <span className="rounded-full border-[1.5px] border-[#CFC7B8] px-[13px] py-[7px] text-sm font-semibold text-[#14211B]">Choose</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section aria-label="Why Pickuply" className="bg-[#14211B] text-[#FFFDF8]">
          <div className="mx-auto flex max-w-[1160px] flex-wrap justify-center gap-x-14 gap-y-5 px-6 py-7 font-display text-[26px] font-semibold">
            <span className="flex items-center gap-3"><TruckIcon stroke="#8FD1AE" size={28} />No truck.</span>
            <span className="flex items-center gap-3"><BoxIcon />No lifting.</span>
            <span className="flex items-center gap-3"><CheckIcon stroke="#8FD1AE" size={28} width={2.4} />No problem.</span>
          </div>
        </section>

        <section className="mx-auto flex max-w-[1160px] flex-wrap items-center gap-10 px-6 pt-[88px] pb-6">
          <div className="flex min-w-0 flex-[1_1_420px] flex-col gap-3.5">
            <div className="max-w-[460px] self-start rounded-[24px] rounded-bl-[6px] border border-[#E4DED2] bg-[#FFFDF8] px-[26px] py-[22px] font-display text-[28px] leading-[1.25] font-medium">
              “Can someone pick this up today, including loading and unloading?”
            </div>
            <span className="pl-2 text-[15px] text-[#46544C]">Sound familiar?</span>
          </div>
          <div className="flex min-w-0 flex-[1_1_380px] flex-col gap-3.5">
            <h2 className="font-display text-[40px] leading-[1.1] font-semibold">Post it on Pickuply.</h2>
            <p className="text-[19px] text-[#46544C]">
              Nearby drivers send offers. You see the full price, pick the driver you like, and they bring it home.
            </p>
          </div>
        </section>

        <section id="services" className="mx-auto flex max-w-[1160px] flex-col gap-7 px-6 pt-[72px] pb-6">
          <h2 className="font-display text-4xl font-semibold max-[720px]:text-[36px] sm:text-[44px]">What we pick up</h2>
          <div className="flex flex-wrap gap-4">
            {services.map((service) => (
              <Link
                key={service.title}
                href={service.href}
                aria-label={service.title}
                className="flex min-w-0 flex-[1_1_240px] flex-col gap-3 rounded-[22px] border border-[#E4DED2] bg-[#FFFDF8] p-[26px]"
              >
                <Image
                  src={service.image}
                  alt={service.alt}
                  width={520}
                  height={260}
                  className="mb-1.5 block h-[180px] w-full rounded-[14px] bg-[#e7e4db] object-cover min-[721px]:h-[150px]"
                />
                <span className="flex size-[52px] items-center justify-center rounded-[14px] bg-[#E3F0E8]">
                  <ServiceIcon name={service.icon} />
                </span>
                <h3 className="text-[21px] font-semibold">{service.title}</h3>
                <p className="text-[#46544C]">{service.text}</p>
              </Link>
            ))}
          </div>
        </section>

        <section id="how" className="mx-auto flex max-w-[1160px] flex-col gap-7 px-6 pt-[72px] pb-6">
          <h2 className="font-display text-4xl font-semibold max-[720px]:text-[36px] sm:text-[44px]">How it works</h2>
          <ol className="m-0 flex list-none flex-wrap gap-4 p-0">
            <Step n="1" title="Post your pickup" text="Add a photo or the listing, where it is, and where it's going." icon="camera" />
            <Step
              n="2"
              title="Set your price / Receive offers"
              text="Name a price, set a budget, or get offers. Drivers respond with offers, and you choose."
              icon="chat"
            />
            <Step n="3" title="You choose who to book" text="See the full price first. Nothing is booked until you choose." icon="person" />
            <Step n="4" title="Charged after delivery" text="Your card is held at booking and charged once your item arrives." icon="card" />
          </ol>
          <div className="flex flex-wrap items-center gap-6 rounded-[22px] border border-[#E4DED2] bg-[#FFFDF8] p-6">
            <GeorgiaMap />
            <div className="min-w-0 flex-1">
              <p className="font-display text-[28px] font-semibold">Serving Georgia</p>
              <p className="mt-2 max-w-xl text-[#46544C]">Pickup and delivery across Georgia.</p>
            </div>
          </div>
        </section>

        <section aria-label="Our promises" className="mx-auto max-w-[1160px] px-6 pt-10 pb-6">
          <div className="flex flex-wrap rounded-[22px] bg-[#17573E] text-[#FFFDF8]">
            {["You choose the driver", "Full price shown before you book", "Card charged after delivery"].map((item) => (
              <div key={item} className="flex flex-[1_1_260px] items-center gap-3 px-[26px] py-[22px] font-semibold">
                <CheckIcon stroke="#8FD1AE" size={22} width={2.4} />
                {item}
              </div>
            ))}
          </div>
        </section>

        <section id="drive" className="mx-auto max-w-[1160px] px-6 pt-[72px] pb-6">
          <div className="flex flex-wrap items-center gap-9 rounded-[28px] border border-[#E4DED2] bg-[#FFFDF8] p-8 sm:p-11">
            <div className="flex min-w-0 flex-[1_1_420px] flex-col gap-3.5">
              <span className="self-start rounded-full bg-[#FBEBD6] px-3.5 py-1.5 text-sm font-semibold text-[#8A4B12]">For drivers</span>
              <h2 className="font-display text-[40px] leading-[1.1] font-semibold">Have a truck or van? Drive with Pickuply.</h2>
              <p className="text-lg text-[#46544C]">Pick the areas you cover, see requests near you, and send your own price. Go Online when it suits you.</p>
            </div>
            <div className="flex min-w-0 flex-[1_1_300px] flex-col gap-3">
              <div className="flex items-center gap-3"><PinIcon />Choose jobs in your areas</div>
              <div className="flex items-center gap-3"><WalletIcon />Set your own price on each offer</div>
              <div className="flex items-center gap-3"><ClockIcon />Work when you want</div>
              <Link href="/drive" className="mt-2 inline-flex items-center gap-2.5 self-start rounded-full bg-[#14211B] px-6 py-3.5 text-[17px] font-semibold text-[#FFFDF8]">
                Apply to drive
                <Arrow size={18} />
              </Link>
            </div>
          </div>
        </section>

        {blog}
        <section className="mx-auto max-w-[1160px] px-6 pt-[72px] pb-[88px]">
          <div className="flex flex-col items-center gap-[22px] rounded-[28px] bg-[#14211B] px-6 py-12 text-center text-[#FFFDF8] sm:px-10 sm:py-16">
            <h2 className="max-w-[760px] font-display text-[clamp(36px,6vw,48px)] leading-[1.1] font-semibold">
              You find it. We lift it, load it, and bring it home.
            </h2>
            <p className="text-lg text-[#C9D6CE]">Post your pickup in a couple of minutes. Drivers respond, and you choose.</p>
            <Link href="/request" className="inline-flex items-center gap-2.5 rounded-full bg-[#8FD1AE] px-7 py-4 text-lg font-bold text-[#14211B]">
              Post a pickup
              <Arrow />
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-[#E4DED2] bg-[#FFFDF8]">
        <div className="mx-auto flex max-w-[1160px] flex-wrap justify-between gap-6 px-6 py-10">
          <div className="flex flex-col gap-1.5">
            <span className="font-display text-[22px] font-semibold">Pickuply</span>
            <span className="text-[#46544C]">You Find It. We Pick It Up.</span>
            <span className="text-[15px] text-[#46544C]">Serving Georgia · Early access</span>
          </div>
          <nav aria-label="Footer" className="flex flex-wrap items-start gap-x-5 gap-y-2">
            <Link href="/terms" className="py-2 font-medium text-[#14211B]">Terms</Link>
            <Link href="/privacy" className="py-2 font-medium text-[#14211B]">Privacy</Link>
            <Link href="/blog" className="py-2 font-medium text-[#14211B]">Blog</Link>
            <Link href="/contact" className="py-2 font-medium text-[#14211B]">Contact</Link>
            <Link href="/help" className="py-2 font-medium text-[#14211B]">Help</Link>
            <CookieSettingsLink className="inline-flex min-h-12 items-center py-2 font-medium text-[#14211B]" />
          </nav>
        </div>
      </footer>
    </div>
  );
}

function Step({ n, title, text, icon }: { n: string; title: string; text: string; icon: "camera" | "chat" | "person" | "card" }) {
  return (
    <li className="flex min-w-0 flex-[1_1_220px] flex-col gap-3 rounded-[22px] border border-[#E4DED2] bg-[#FFFDF8] p-6">
      <span className="flex items-center gap-2.5">
        <span className="flex size-[34px] items-center justify-center rounded-full bg-[#17573E] font-bold text-[#FFFDF8]">{n}</span>
        <StepIcon name={icon} />
      </span>
      <h3 className="text-xl font-semibold">{title}</h3>
      <p className="text-base text-[#46544C]">{text}</p>
    </li>
  );
}

function GeorgiaMap() {
  return (
    <svg viewBox="0 0 120 170" className="h-40 w-28 shrink-0 text-[#17573E]" role="img" aria-label="Outline of Georgia">
      <path
        d="M24 16c18-6 48-8 70 2l14 10 2 14-10 8 8 12-8 14 6 16-8 16 8 18-10 16-12 14-16 8-18-4-12-16-8-18-8-20-6-18 2-16 6-14 4-16z"
        fill="#E3F0E8"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Arrow({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </svg>
  );
}

function CardIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#17573E" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect width="20" height="14" x="2" y="5" rx="2" />
      <line x1="2" x2="22" y1="10" y2="10" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#17573E" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

function CheckIcon({ stroke, size, width }: { stroke: string; size: number; width: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function TruckIcon({ stroke = "#17573E", size = 26 }: { stroke?: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2" />
      <path d="M15 18H9" />
      <path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14" />
      <circle cx="17" cy="18" r="2" />
      <circle cx="7" cy="18" r="2" />
    </svg>
  );
}

function BoxIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#8FD1AE" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m7.5 4.27 9 5.15" />
      <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
      <path d="m3.3 7 8.7 5 8.7-5" />
      <path d="M12 22V12" />
    </svg>
  );
}

function ServiceIcon({ name }: { name: "truck" | "gift" | "bag" | "trash" }) {
  if (name === "truck") return <TruckIcon />;
  if (name === "gift") {
    return (
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#17573E" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="3" y="8" width="18" height="4" rx="1" />
        <path d="M12 8v13" />
        <path d="M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7" />
        <path d="M7.5 8a2.5 2.5 0 0 1 0-5C9.5 3 11 5 12 8c1-3 2.5-5 4.5-5a2.5 2.5 0 0 1 0 5" />
      </svg>
    );
  }
  if (name === "bag") {
    return (
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#17573E" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z" />
        <path d="M3 6h18" />
        <path d="M16 10a4 4 0 0 1-8 0" />
      </svg>
    );
  }
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#17573E" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 6h18" />
      <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
      <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
    </svg>
  );
}

function StepIcon({ name }: { name: "camera" | "chat" | "person" | "card" }) {
  const common = { width: 22, height: 22, viewBox: "0 0 24 24", fill: "none", stroke: "#17573E", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true as const };
  if (name === "camera") {
    return (
      <svg {...common}>
        <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" />
        <circle cx="12" cy="13" r="3" />
      </svg>
    );
  }
  if (name === "chat") {
    return (
      <svg {...common}>
        <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
      </svg>
    );
  }
  if (name === "person") {
    return (
      <svg {...common}>
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <polyline points="16 11 18 13 22 9" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <rect width="20" height="14" x="2" y="5" rx="2" />
      <line x1="2" x2="22" y1="10" y2="10" />
    </svg>
  );
}

function PinIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#17573E" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  );
}

function WalletIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#17573E" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1" />
      <path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4" />
    </svg>
  );
}
