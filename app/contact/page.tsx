import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/placeholder-page";

export const metadata: Metadata = {
  title: "Contact",
};

export default function ContactPage() {
  return (
    <PlaceholderPage
      eyebrow="Help"
      title="Contact"
      description="A contact path will be posted here."
    />
  );
}
