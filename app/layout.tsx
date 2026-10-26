import type { Metadata, Viewport } from "next";
import { Fraunces, Outfit } from "next/font/google";
import Script from "next/script";
import { Suspense } from "react";
import { HeaderSession } from "@/components/header-session";
import { ScrollRestore } from "@/components/scroll-restore";
import { UpdateBanner } from "@/components/pwa/update-banner";
import { MarketingSlot } from "@/components/marketing-chrome";
import { MobileFrame } from "@/components/mobile/mobile-frame";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import "./globals.css";

const outfit = Outfit({
  variable: "--font-outfit",
  subsets: ["latin"],
  display: "swap",
});

const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Pickuply",
    template: "%s · Pickuply",
  },
  description: "Found it. Bought it. Can't pick it up? We'll bring it home.",
  applicationName: "Pickuply",
  appleWebApp: {
    capable: true,
    title: "Pickuply",
    statusBarStyle: "default",
  },
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#145a3a",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${outfit.variable} ${fraunces.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="flex min-h-full flex-col bg-paper font-sans text-ink">
        <UpdateBanner />
        <Script id="landing-flag" strategy="beforeInteractive">
          {`if(location.pathname==='/')document.documentElement.dataset.landing='1'`}
        </Script>
        <Suspense fallback={<SiteHeader state={{ status: "signed-out" }} />}>
          <MarketingSlot>
            <HeaderSession />
          </MarketingSlot>
        </Suspense>
        <div data-app-scroll className="flex min-h-0 w-full flex-1 flex-col">
          <Suspense fallback={null}>
            <ScrollRestore />
          </Suspense>
          {children}
          <Suspense fallback={<SiteFooter />}>
            <MarketingSlot>
              <SiteFooter />
            </MarketingSlot>
          </Suspense>
        </div>
        <Suspense fallback={null}>
          <MobileFrame />
        </Suspense>
      </body>
    </html>
  );
}
