import Link from "next/link";

export type LegalSection = {
  id: string;
  heading: string;
  paragraphs: string[];
};

export function LegalDocument({
  title,
  effective,
  sections,
}: {
  title: string;
  effective: string;
  sections: LegalSection[];
}) {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:py-12">
      <p className="text-sm font-semibold tracking-wide text-brand uppercase">Legal</p>
      <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight text-ink">{title}</h1>
      <p className="mt-3 text-base text-muted">Effective date: {effective}</p>
      <p className="mt-4 rounded-2xl bg-brand-soft px-4 py-3 text-base leading-relaxed text-ink">
        This page follows the October 22, 2026 draft. A lawyer must approve it before public launch.
      </p>
      <nav aria-label="Contents" className="mt-8">
        <h2 className="text-lg font-semibold text-ink">Contents</h2>
        <ol className="mt-3 grid gap-2">
          {sections.map((section, index) => (
            <li key={section.id}>
              <a href={`#${section.id}`} className="inline-flex min-h-12 items-center text-base font-semibold text-brand underline-offset-4 hover:underline">
                {index + 1}. {section.heading}
              </a>
            </li>
          ))}
        </ol>
      </nav>
      <div className="mt-8 grid gap-8">
        {sections.map((section, index) => (
          <section key={section.id} id={section.id} className="scroll-mt-6">
            <h2 className="font-display text-2xl font-semibold tracking-tight text-ink">
              {index + 1}. {section.heading}
            </h2>
            {section.paragraphs.map((paragraph, paragraphIndex) => (
              <p key={paragraphIndex} className="mt-3 text-base leading-relaxed text-ink">
                {paragraph}
              </p>
            ))}
          </section>
        ))}
      </div>
      <p className="mt-10">
        <Link href="/" className="inline-flex min-h-12 items-center font-semibold text-brand">
          Back to Pickuply
        </Link>
      </p>
    </main>
  );
}
