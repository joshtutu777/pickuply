import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { submitSupportRequest } from "@/app/contact/actions";
import { ContactForm } from "@/components/support/contact-form";
import { LoadingMain } from "@/components/loading-main";
import { getOptionalSession } from "@/lib/auth/session";
import { supportStatusLabel, supportTopicLabel } from "@/lib/support/ticket";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Support",
  description: "Questions about a pickup, delivery, or your account? Send Pickuply a message.",
};

export default function ContactPage({ searchParams }: PageProps<"/contact">) {
  return (
    <Suspense fallback={<LoadingMain />}>
      <Contact searchParams={searchParams} />
    </Suspense>
  );
}

async function Contact({ searchParams }: { searchParams: PageProps<"/contact">["searchParams"] }) {
  const query = await searchParams;
  const session = await getOptionalSession();
  const supabase = await createClient();
  let firstName = "";
  let lastName = "";
  let email = "";
  let jobs: { id: string; label: string }[] = [];
  let tickets: { id: string; reference: string; topic: string; status: string; updated_at: string }[] = [];
  if (session) {
    const name = session.fullName?.trim() ?? "";
    const parts = name.split(/\s+/);
    firstName = parts[0] ?? "";
    lastName = parts.slice(1).join(" ");
    const { data: user } = await supabase.auth.getUser();
    email = user.user?.email ?? "";
    const { data: jobRows } = await supabase
      .from("jobs")
      .select("id, service, pickup_area")
      .or(`customer_id.eq.${session.userId},assigned_driver_id.eq.${session.userId}`)
      .order("updated_at", { ascending: false })
      .limit(20);
    jobs = (jobRows ?? []).map((job) => ({ id: job.id, label: `${job.service} · ${job.pickup_area}` }));
    const { data: own } = await supabase
      .from("support_tickets")
      .select("id, reference, topic, status, updated_at")
      .eq("profile_id", session.userId)
      .order("updated_at", { ascending: false })
      .limit(20);
    tickets = own ?? [];
  }
  const error = typeof query.error === "string" ? query.error : null;
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">
      <p className="text-sm font-semibold tracking-wide text-brand uppercase">Support</p>
      <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight">How can we help?</h1>
      <p className="mt-2 max-w-xl text-lg text-muted">Questions about a pickup, delivery, or your account? We're here to help.</p>
      {query.sent === "1" ? (
        <p role="status" className="mt-4 rounded-3xl bg-brand-soft p-4 text-base text-ink">
          Message sent{query.ref ? ` · ${query.ref}` : ""}. {session ? "Replies appear on this page when you are signed in." : "If you have an account, sign in to read replies. Otherwise we reply by email when email delivery is available."}
        </p>
      ) : null}
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <div className="grid content-start gap-3">
          <section className="rounded-3xl bg-paper-raised p-5 ring-1 ring-line">
            <h2 className="text-xl font-semibold">Email Support</h2>
            <p className="mt-2 text-base text-muted">Use the form. Account questions can also go to info@pickuplyapp.com.</p>
          </section>
          <section className="rounded-3xl bg-paper-raised p-5 ring-1 ring-line">
            <h2 className="text-xl font-semibold">Help with a Delivery</h2>
            <p className="mt-2 text-base text-muted">A problem with an assigned job stays on that job.</p>
            <Link href={session ? "/help" : "/login?next=/help"} className="mt-3 inline-flex min-h-12 items-center font-semibold text-brand">
              Report a problem
            </Link>
          </section>
          <section className="rounded-3xl bg-paper-raised p-5 ring-1 ring-line">
            <h2 className="text-xl font-semibold">General Questions</h2>
            <p className="mt-2 text-base text-muted">Read common answers, or send a message if yours is not listed.</p>
            <Link href={session ? "/help" : "/login?next=/help"} className="mt-3 inline-flex min-h-12 items-center font-semibold text-brand">
              Help topics
            </Link>
          </section>
        </div>
        <ContactForm action={submitSupportRequest} defaults={{ firstName, lastName, email }} jobs={jobs} error={error} />
      </div>
      <p className="mt-4 text-base text-muted">
        <Link href="/privacy" className="font-semibold text-brand">Privacy policy</Link>
      </p>
      {tickets.length > 0 ? (
        <section className="mt-8">
          <h2 className="font-display text-2xl font-semibold">Your requests</h2>
          <ul className="mt-3 grid gap-2">
            {tickets.map((ticket) => (
              <li key={ticket.id}>
                <Link href={`/contact/tickets/${ticket.id}`} className="flex min-h-12 items-center justify-between gap-3 rounded-3xl bg-paper-raised px-4 ring-1 ring-line">
                  <span className="font-semibold">{ticket.reference} · {supportTopicLabel(ticket.topic)}</span>
                  <span>{supportStatusLabel(ticket.status)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
