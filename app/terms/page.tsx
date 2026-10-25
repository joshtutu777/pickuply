import type { Metadata } from "next";
import { LegalDocument } from "@/components/legal-document";
import { termsEffective, termsSections } from "@/lib/legal/terms";

export const metadata: Metadata = {
  title: "Terms of Service",
};

export default function TermsPage() {
  return <LegalDocument title="Terms of Service" effective={termsEffective} sections={termsSections} />;
}
