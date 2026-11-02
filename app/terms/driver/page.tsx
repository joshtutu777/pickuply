import type { Metadata } from "next";
import { LegalDocument } from "@/components/legal-document";
import { driverTermsEffective, driverTermsSections } from "@/lib/legal/driver-terms";
import { publicMetadata } from "@/lib/seo";

export const metadata: Metadata = publicMetadata({
  title: "Driver Terms",
  description: "The terms for drivers who pick up and deliver with Pickuply.",
  path: "/terms/driver",
});

export default function DriverTermsPage() {
  return (
    <LegalDocument
      title="Driver Terms"
      effective={driverTermsEffective}
      sections={driverTermsSections}
      related={{ href: "/terms", label: "Terms of Service" }}
    />
  );
}
