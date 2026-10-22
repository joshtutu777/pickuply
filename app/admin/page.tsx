import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/placeholder-page";

export const metadata: Metadata = {
  title: "Admin",
};

export default function AdminPage() {
  return (
    <PlaceholderPage
      eyebrow="Admin"
      title="Admin"
      description="Operations tools will live here. The admin dashboard is not built yet."
    />
  );
}
