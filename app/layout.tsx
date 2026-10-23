import type { Metadata, Viewport } from "next";
import { Fraunces, Outfit } from "next/font/google";
import { Suspense } from "react";
import { HeaderSession } from "@/components/header-session";
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
    >
      <body className="flex min-h-full flex-col bg-paper font-sans text-ink">
        <Suspense fallback={<SiteHeader state={{ status: "signed-out" }} />}>
          <HeaderSession />
        </Suspense>
        {children}
        <SiteFooter />
        <Suspense fallback={null}>
          <MobileFrame />
        </Suspense>
      </body>
    </html>
  );
}
