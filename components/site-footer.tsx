import Link from "next/link";

const footerLink =
  "inline-flex min-h-12 items-center justify-center rounded-full px-4 text-base font-semibold text-ink underline-offset-4 hover:underline";

export function SiteFooter() {
  return (
    <footer data-app-footer="" className="mt-auto border-t border-line bg-paper-raised">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-2 px-4 py-8">
        <p className="font-display text-2xl font-semibold tracking-tight text-ink">
          Pickuply
        </p>
        <p className="max-w-md text-base leading-relaxed text-muted">
          You find it. We pick it up.
        </p>
        <nav aria-label="Footer" className="mt-3 flex flex-col sm:flex-row sm:gap-2">
          <Link href="/terms" className={footerLink}>
            Terms
          </Link>
          <Link href="/privacy" className={footerLink}>
            Privacy
          </Link>
          <Link href="/contact" className={footerLink}>
            Contact
          </Link>
          <Link href="/help" className={footerLink}>
            Help
          </Link>
        </nav>
      </div>
    </footer>
  );
}
