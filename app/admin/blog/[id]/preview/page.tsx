import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ArticleView } from "@/components/blog/article-view";
import { LoadingMain } from "@/components/loading-main";
import { requireAdmin } from "@/lib/auth/session";
import { parseBlocks } from "@/lib/blog/content";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Preview", robots: { index: false, follow: false } };

export default function PreviewArticlePage({ params }: PageProps<"/admin/blog/[id]/preview">) {
  return (
    <Suspense fallback={<LoadingMain />}>
      <Preview params={params} />
    </Suspense>
  );
}

async function Preview({ params }: { params: PageProps<"/admin/blog/[id]/preview">["params"] }) {
  await requireAdmin("/admin/blog");
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase
    .from("blog_posts")
    .select("id, title, excerpt, category, published_at, author_name, cover_path, cover_alt, body")
    .eq("id", id)
    .maybeSingle();
  if (!data) notFound();
  return (
    <ArticleView
      preview
      postId={data.id}
      title={data.title}
      excerpt={data.excerpt}
      category={data.category}
      publishedAt={data.published_at}
      authorName={data.author_name}
      coverPath={data.cover_path}
      coverAlt={data.cover_alt}
      blocks={parseBlocks(data.body) ?? []}
    />
  );
}
