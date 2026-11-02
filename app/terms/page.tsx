import type { Metadata } from "next";
import { LegalDocument } from "@/components/legal-document";
import { termsEffective, termsSections } from "@/lib/legal/terms";
import { publicMetadata } from "@/lib/seo";

export const metadata: Metadata = publicMetadata({
  title: "Terms of Service",
  description: "The terms for requesting a pickup, delivery, or junk haul with Pickuply.",
  path: "/terms",
});

export default function TermsPage() {
  return (
    <LegalDocument
      title="Terms of Service"
      effective={termsEffective}
      sections={termsSections}
      related={{ href: "/privacy", label: "Privacy Policy" }}
    />
  );
}
