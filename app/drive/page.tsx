import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getOptionalSession } from "@/lib/auth/session";
import { zones } from "@/lib/constants";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Drive with Pickuply",
};

const applyHref = "/login?next=/driver/onboarding&intent=driver";

const steps = [
  { title: "Apply in 5 minutes", detail: "Share your license, insurance, and vehicle photos." },
  { title: "Get approved", detail: "We review your application before you can take jobs." },
  { title: "Pick jobs near you and get paid", detail: "Choose the jobs you want. Nothing is assigned until you accept." },
];

const needs = [
  "A valid driver's license",
  "Insurance",
  "A vehicle: car, SUV, pickup, van, box truck, or trailer",
  "A smartphone",
];

const faqs = [
  {
    question: "Do I need a truck?",
    answer:
      "No. A car, SUV, pickup, van, box truck, or trailer can work. Choose the jobs that fit what you drive.",
  },
  {
    question: "How do I get paid?",
    answer:
      "Pickuply pays you through Stripe after a completed job. You see your exact earnings before you accept. A Stripe payout is sent to the bank account you add during setup.",
  },
  {
    question: "Can I choose my jobs?",
    answer: "Yes. You pick the jobs you want. An offer is not a booking until you accept it.",
  },
  {
    question: "Which areas?",
    answer: zones.map((zone) => `${zone.name}: ${zone.areas.join(", ")}`).join(". ") + ".",
  },
];

export default async function DrivePage() {
  const session = await getOptionalSession();
  if (session?.role === "driver") redirect("/driver");
  if (session) {
    const supabase = await createClient();
    const { data } = await supabase.from("drivers").select("profile_id").eq("profile_id", session.userId).maybeSingle();
    if (data) redirect("/driver");
  }
  return (
    <main className="flex-1">
      <section className="px-4 pt-4 sm:pt-8">
        <div className="mx-auto max-w-3xl rounded-[2rem] bg-paper-raised px-5 py-8 ring-1 ring-line sm:px-10 sm:py-14">
          <p className="text-sm font-semibold tracking-wide text-brand uppercase">Drive</p>
          <h1 className="mt-3 font-display text-[clamp(2.15rem,9vw,3.5rem)] font-semibold leading-[1.08] tracking-tight text-ink">
            Earn with your truck, van, or SUV
          </h1>
          <p className="mt-5 text-lg leading-relaxed text-ink">
            You see your exact earnings before you accept any job.
          </p>
          <Link
            href={applyHref}
            className="mt-8 inline-flex min-h-14 w-full items-center justify-center rounded-full bg-brand px-6 text-center text-lg font-semibold text-white transition-colors hover:bg-brand-dark sm:w-auto"
          >
            Get started
          </Link>
        </div>
      </section>

      <section aria-labelledby="how-heading" className="px-4 py-10">
        <div className="mx-auto max-w-3xl">
          <h2 id="how-heading" className="font-display text-3xl font-semibold tracking-tight text-ink">
            How it works
          </h2>
          <ol className="mt-5 grid gap-3">
            {steps.map((step, index) => (
              <li key={step.title} className="rounded-2xl bg-paper-raised p-5 ring-1 ring-line">
                <p className="text-sm font-semibold tracking-wide text-brand uppercase">Step {index + 1}</p>
                <h3 className="mt-2 text-xl font-semibold text-ink">{step.title}</h3>
                <p className="mt-2 text-base leading-relaxed text-muted">{step.detail}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section aria-labelledby="need-heading" className="px-4 pb-10">
        <div className="mx-auto max-w-3xl">
          <h2 id="need-heading" className="font-display text-3xl font-semibold tracking-tight text-ink">
            What you need
          </h2>
          <ul className="mt-5 grid gap-3">
            {needs.map((item) => (
              <li key={item} className="rounded-2xl bg-paper-raised px-5 py-4 text-base text-ink ring-1 ring-line">
                {item}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section aria-labelledby="service-heading" className="px-4 pb-10">
        <div className="mx-auto grid max-w-3xl gap-3 sm:grid-cols-2">
          <article className="rounded-2xl bg-paper-raised p-5 ring-1 ring-line">
            <h2 id="service-heading" className="text-xl font-semibold text-ink">
              Light Load
            </h2>
            <p className="mt-2 text-base leading-relaxed text-muted">No heavy lifting. You drive; the customer handles the load.</p>
          </article>
          <article className="rounded-2xl bg-paper-raised p-5 ring-1 ring-line">
            <h2 className="text-xl font-semibold text-ink">Full Service</h2>
            <p className="mt-2 text-base leading-relaxed text-muted">You help load, haul, and unload.</p>
          </article>
        </div>
      </section>

      <section aria-labelledby="faq-heading" className="px-4 pb-14">
        <div className="mx-auto max-w-3xl">
          <h2 id="faq-heading" className="font-display text-3xl font-semibold tracking-tight text-ink">
            Questions
          </h2>
          <div className="mt-5 grid gap-3">
            {faqs.map((item) => (
              <details key={item.question} className="rounded-2xl bg-paper-raised px-5 py-4 ring-1 ring-line">
                <summary className="min-h-12 cursor-pointer text-base font-semibold text-ink">{item.question}</summary>
                <p className="mt-2 text-base leading-relaxed text-muted">{item.answer}</p>
              </details>
            ))}
          </div>
          <Link
            href={applyHref}
            className="mt-8 inline-flex min-h-14 w-full items-center justify-center rounded-full bg-brand px-6 text-center text-lg font-semibold text-white transition-colors hover:bg-brand-dark"
          >
            Start your application
          </Link>
        </div>
      </section>
    </main>
  );
}
