import type { Metadata } from "next";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { LoadingMain } from "@/components/loading-main";
import { ArticleView } from "@/components/blog/article-view";
import { parseBlocks } from "@/lib/blog/content";
import { articlePath, publicSiteUrl } from "@/lib/blog/site";
import { createClient } from "@/lib/supabase/server";

type Article = {
  id: string;
  title: string;
  slug: string;
  excerpt: string;
  category: string;
  body: unknown;
  cover_path: string | null;
  cover_alt: string;
  author_name: string;
  seo_title: string;
  seo_description: string;
  published_at: string | null;
  updated_at: string;
};

async function publishedArticle(slug: string): Promise<Article | null> {
  await connection();
  const supabase = await createClient();
  const { data } = await supabase
    .from("blog_posts")
    .select("id, title, slug, excerpt, category, body, cover_path, cover_alt, author_name, seo_title, seo_description, published_at, updated_at")
    .eq("status", "published")
    .eq("slug", slug)
    .maybeSingle();
  return data;
}

export async function generateMetadata({ params }: PageProps<"/blog/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const article = await publishedArticle(slug);
  if (!article) return { title: "Article", robots: { index: false, follow: false } };
  const site = publicSiteUrl();
  const title = article.seo_title || article.title;
  const description = article.seo_description || article.excerpt || undefined;
  const canonical = `${site}${articlePath(article.slug)}`;
  const image = article.cover_path ? `${site}/blog/${article.slug}/cover` : undefined;
  return {
    title,
    description,
    alternates: { canonical },
    openGraph: {
      type: "article",
      url: canonical,
      title,
      description,
      images: image ? [{ url: image, alt: article.cover_alt || article.title }] : undefined,
    },
    robots: { index: true, follow: true },
  };
}

export default function BlogArticlePage({ params }: PageProps<"/blog/[slug]">) {
  return (
    <Suspense fallback={<LoadingMain />}>
      <PublishedArticle params={params} />
    </Suspense>
  );
}

async function PublishedArticle({ params }: { params: PageProps<"/blog/[slug]">["params"] }) {
  const { slug } = await params;
  const article = await publishedArticle(slug);
  if (!article) notFound();
  const site = publicSiteUrl();
  const data: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: article.title,
    mainEntityOfPage: `${site}${articlePath(article.slug)}`,
  };
  if (article.published_at) data.datePublished = article.published_at;
  if (article.updated_at) data.dateModified = article.updated_at;
  if (article.excerpt) data.description = article.excerpt;
  if (article.author_name) data.author = { "@type": "Person", name: article.author_name };
  if (article.cover_path) data.image = `${site}/blog/${article.slug}/cover`;
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }} />
      <ArticleView
        postId={article.id}
        title={article.title}
        excerpt={article.excerpt}
        category={article.category}
        publishedAt={article.published_at}
        authorName={article.author_name}
        coverPath={article.cover_path}
        coverAlt={article.cover_alt}
        blocks={parseBlocks(article.body) ?? []}
      />
    </>
  );
}
