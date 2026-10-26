import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { LoadingMain } from "@/components/loading-main";
import { connection } from "next/server";
import { blogCategories, blogDateLabel, blogPageNumber, categoryLabel } from "@/lib/blog/content";
import { publicSiteUrl } from "@/lib/blog/site";
import { articleImageSrc } from "@/lib/blog/site";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Blog",
  description: "Pickup and delivery guides from Pickuply.",
  alternates: { canonical: `${publicSiteUrl()}/blog` },
};

const pageSize = 6;

export default function BlogPage({ searchParams }: PageProps<"/blog">) {
  return (
    <Suspense fallback={<LoadingMain />}>
      <BlogList searchParams={searchParams} />
    </Suspense>
  );
}

async function BlogList({ searchParams }: { searchParams: PageProps<"/blog">["searchParams"] }) {
  await connection();
  const query = await searchParams;
  const q = typeof query.q === "string" ? query.q.trim().slice(0, 80) : "";
  const category = blogCategories.some((item) => item.id === query.category) ? String(query.category) : "";
  const page = blogPageNumber(typeof query.page === "string" ? query.page : undefined);
  const supabase = await createClient();
  let request = supabase
    .from("blog_posts")
    .select("id, title, slug, excerpt, category, cover_path, cover_alt, published_at", { count: "exact" })
    .eq("status", "published")
    .order("published_at", { ascending: false });
  if (category) request = request.eq("category", category);
  const safeQuery = q.replace(/[^a-zA-Z0-9 ]/g, "").trim();
  if (safeQuery) request = request.or(`title.ilike.%${safeQuery}%,excerpt.ilike.%${safeQuery}%`);
  const { data, count, error } = await request.range((page - 1) * pageSize, page * pageSize - 1);
  const articles = data ?? [];
  const pages = Math.max(1, Math.ceil((count ?? 0) / pageSize));
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (category) params.set("category", category);
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">
      <p className="text-sm font-semibold tracking-wide text-brand uppercase">Pickuply</p>
      <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight">Blog</h1>
      <p className="mt-2 max-w-xl text-lg text-muted">Guides for local pickup, delivery, and driving in Georgia.</p>
      <form method="get" className="mt-5 grid gap-3" role="search">
        <label className="sr-only" htmlFor="article-search">Search articles</label>
        <input id="article-search" name="q" defaultValue={q} placeholder="Search articles" className="min-h-12 rounded-full border border-line bg-paper px-4" />
        <button className="inline-flex min-h-12 items-center justify-center rounded-full bg-brand px-5 font-semibold text-white">Search</button>
        {category ? <input type="hidden" name="category" value={category} /> : null}
      </form>
      <nav aria-label="Categories" className="mt-4 flex flex-wrap gap-2">
        <Link href="/blog" className={`inline-flex min-h-12 items-center rounded-full px-4 font-semibold ${category ? "bg-paper-raised text-ink ring-1 ring-line" : "bg-brand text-white"}`}>
          All
        </Link>
        {blogCategories.map((item) => (
          <Link
            key={item.id}
            href={`/blog?category=${item.id}`}
            className={`inline-flex min-h-12 items-center rounded-full px-4 font-semibold ${category === item.id ? "bg-brand text-white" : "bg-paper-raised text-ink ring-1 ring-line"}`}
          >
            {item.label}
          </Link>
        ))}
      </nav>
      {error ? <p role="alert" className="mt-6 text-danger">Articles could not be loaded.</p> : null}
      {!error && articles.length === 0 ? (
        <p className="mt-8 rounded-3xl bg-paper-raised p-6 text-lg text-ink">
          {q || category ? "No articles match that search." : "No articles are published yet. Check back for pickup and delivery guides."}
        </p>
      ) : null}
      <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {articles.map((article) => (
          <li key={article.id}>
            <article className="flex h-full flex-col overflow-hidden rounded-3xl bg-paper-raised ring-1 ring-line">
              {article.cover_path ? (
                <img src={articleImageSrc(article.id, article.cover_path)} alt={article.cover_alt || ""} className="aspect-video w-full object-cover" />
              ) : (
                <div className="aspect-video bg-brand-soft" />
              )}
              <div className="flex flex-1 flex-col gap-2 p-4">
                <p className="text-sm font-semibold text-brand">{categoryLabel(article.category)}</p>
                <h2 className="font-display text-2xl font-semibold tracking-tight">
                  <Link href={`/blog/${article.slug}`} className="hover:underline">{article.title}</Link>
                </h2>
                {article.excerpt ? <p className="text-base text-muted">{article.excerpt}</p> : null}
                <p className="mt-auto text-sm text-muted">{blogDateLabel(article.published_at)}</p>
              </div>
            </article>
          </li>
        ))}
      </ul>
      {pages > 1 ? (
        <nav aria-label="Pages" className="mt-6 flex gap-3">
          {page > 1 ? <Link href={pageHref(params, page - 1)} className="inline-flex min-h-12 items-center font-semibold text-brand">Previous</Link> : null}
          <span className="inline-flex min-h-12 items-center">Page {page} of {pages}</span>
          {page < pages ? <Link href={pageHref(params, page + 1)} className="inline-flex min-h-12 items-center font-semibold text-brand">Next</Link> : null}
        </nav>
      ) : null}
    </main>
  );
}

function pageHref(params: URLSearchParams, page: number) {
  const next = new URLSearchParams(params);
  next.set("page", String(page));
  return `/blog?${next.toString()}`;
}
