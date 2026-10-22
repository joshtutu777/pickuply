import { ForbiddenAlert } from "@/components/forbidden-alert";

type PlaceholderPageProps = {
  eyebrow: string;
  title: string;
  description: string;
  forbidden?: boolean;
};

export function PlaceholderPage({
  eyebrow,
  title,
  description,
  forbidden = false,
}: PlaceholderPageProps) {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center px-5 py-14">
      <p className="text-sm font-semibold tracking-wide text-brand uppercase">
        {eyebrow}
      </p>
      <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight text-ink">
        {title}
      </h1>
      <p className="mt-4 text-lg leading-relaxed text-muted">{description}</p>
      {forbidden ? <ForbiddenAlert /> : null}
    </main>
  );
}
