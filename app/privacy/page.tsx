import type { Metadata } from "next";
import { LegalDocument } from "@/components/legal-document";
import { privacyEffective, privacySections } from "@/lib/legal/privacy";
import { publicMetadata } from "@/lib/seo";

export const metadata: Metadata = publicMetadata({
  title: "Privacy Policy",
  description: "How Pickuply collects, uses, and protects customer and driver information.",
  path: "/privacy",
});

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
