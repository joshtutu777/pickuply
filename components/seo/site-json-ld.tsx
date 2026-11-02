import { siteStructuredData } from "@/lib/seo";

/** Homepage facts for search engines. The text is also in the page itself. */
export function SiteJsonLd() {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(siteStructuredData()) }}
    />
  );
}
