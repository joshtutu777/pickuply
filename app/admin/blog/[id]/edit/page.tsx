import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { saveArticle, unpublishArticle } from "@/app/admin/blog/actions";
import { ArticleForm } from "@/components/blog/article-form";
import { DeleteArticle } from "@/components/blog/delete-article";
import { LoadingMain } from "@/components/loading-main";
import { requireAdmin } from "@/lib/auth/session";
import { parseBlocks, type ArticleBlock } from "@/lib/blog/content";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Edit article" };

const errors: Record<string, string> = {
  fields: "Check the title, slug, and category.",
  body: "The article body could not be read.",
  save: "The article could not be saved.",
  image: "The cover image was not accepted.",
};

export default function EditArticlePage({ params, searchParams }: PageProps<"/admin/blog/[id]/edit">) {
  return (
    <Suspense fallback={<LoadingMain />}>
      <EditArticle params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function EditArticle({
  params,
  searchParams,
}: {
  params: PageProps<"/admin/blog/[id]/edit">["params"];
  searchParams: PageProps<"/admin/blog/[id]/edit">["searchParams"];
}) {
  await requireAdmin("/admin/blog");
  const { id } = await params;
  const query = await searchParams;
  const supabase = await createClient();
  const { data } = await supabase.from("blog_posts").select("id, title, slug, excerpt, category, author_name, seo_title, seo_description, cover_alt, body, status, published_at").eq("id", id).maybeSingle();
  if (!data) notFound();
  const body = parseBlocks(data.body) ?? [];
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">
      <p className="text-sm font-semibold tracking-wide text-brand uppercase">{data.status === "published" ? "Published" : "Draft"}</p>
      <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight">Edit article</h1>
      {query.saved === "1" ? <p className="mt-4 text-base">Saved.</p> : null}
      <div className="mt-4 flex flex-wrap gap-3">
        <Link href={`/admin/blog/${id}/preview`} className="inline-flex min-h-12 items-center font-semibold text-brand">Preview</Link>
        {data.status === "published" ? (
          <form action={unpublishArticle}>
            <input type="hidden" name="id" value={id} />
            <button className="inline-flex min-h-12 items-center font-semibold text-ink">Unpublish</button>
          </form>
        ) : null}
        <DeleteArticle id={id} />
      </div>
      <div className="mt-6">
        <ArticleForm
          action={saveArticle}
          error={typeof query.error === "string" ? errors[query.error] : null}
          initial={{
            id,
            title: data.title,
            slug: data.slug,
            excerpt: data.excerpt,
            category: data.category,
            authorName: data.author_name,
            seoTitle: data.seo_title,
            seoDescription: data.seo_description,
            coverAlt: data.cover_alt,
            body: body as ArticleBlock[],
            status: data.status === "published" ? "published" : "draft",
            wasPublished: data.status === "published" || data.published_at != null,
          }}
        />
      </div>
    </main>
  );
}

