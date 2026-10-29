import type { Metadata } from "next";
import { LegalDocument } from "@/components/legal-document";
import { driverTermsEffective, driverTermsSections } from "@/lib/legal/driver-terms";

export const metadata: Metadata = {
  title: "Driver Terms",
};

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
