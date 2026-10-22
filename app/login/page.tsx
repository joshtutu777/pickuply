import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/placeholder-page";

export const metadata: Metadata = {
  title: "Log in",
};

export default function LoginPage() {
  return (
    <PlaceholderPage
      eyebrow="Account"
      title="Log in"
      description="Customers and drivers will sign in here. Phone sign-in is not connected yet."
    />
  );
}
