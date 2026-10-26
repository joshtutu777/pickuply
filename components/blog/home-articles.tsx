import Link from "next/link";
import { connection } from "next/server";
import { blogDateLabel, categoryLabel } from "@/lib/blog/content";
import { createClient } from "@/lib/supabase/server";

export async function HomeArticles() {
  try {
    await connection();
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("blog_posts")
      .select("slug, title, excerpt, category, published_at")
      .eq("status", "published")
      .order("published_at", { ascending: false })
      .limit(3);
    if (error || !data || data.length === 0) return null;
    return (
      <section className="mx-auto max-w-[1160px] px-6 pt-12" aria-label="From the Pickuply Blog">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 className="font-display text-3xl font-semibold tracking-tight">From the Pickuply Blog</h2>
          <Link href="/blog" className="inline-flex min-h-12 items-center font-semibold text-[#17573E]">
            View all articles
          </Link>
        </div>
        <ul className="mt-5 grid gap-4 sm:grid-cols-3">
          {data.map((article) => (
            <li key={article.slug} className="rounded-[22px] border border-[#E4DED2] bg-[#FFFDF8] p-5">
              <p className="text-sm font-semibold text-[#17573E]">{categoryLabel(article.category)}</p>
              <h3 className="mt-2 text-xl font-semibold">
                <Link href={`/blog/${article.slug}`} className="hover:underline">
                  {article.title}
                </Link>
              </h3>
              {article.excerpt ? <p className="mt-2 text-base text-[#46544C]">{article.excerpt}</p> : null}
              {blogDateLabel(article.published_at) ? (
                <p className="mt-3 text-sm text-[#46544C]">{blogDateLabel(article.published_at)}</p>
              ) : null}
            </li>
          ))}
        </ul>
      </section>
    );
  } catch {
    return null;
  }
}
