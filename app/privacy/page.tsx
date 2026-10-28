import type { Metadata } from "next";
import { LegalDocument } from "@/components/legal-document";
import { privacyEffective, privacySections } from "@/lib/legal/privacy";

export const metadata: Metadata = {
  title: "Privacy Policy",
};

export default function PrivacyPage() {
  return (
    <LegalDocument
      title="Privacy Policy"
      effective={privacyEffective}
      sections={privacySections}
      related={{ href: "/terms", label: "Terms of Service" }}
    />
  );
}
