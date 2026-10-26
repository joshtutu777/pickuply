import type { Metadata } from "next";
import { Suspense } from "react";
import { ArticleForm } from "@/components/blog/article-form";
import { LoadingMain } from "@/components/loading-main";
import { requireAdmin } from "@/lib/auth/session";
import { saveArticle } from "@/app/admin/blog/actions";

export const metadata: Metadata = { title: "New article" };

const errors: Record<string, string> = {
  fields: "Check the title, slug, and category.",
  body: "The article body could not be read.",
  save: "The article could not be saved.",
  image: "The cover image was not accepted.",
};

export default function NewArticlePage({ searchParams }: PageProps<"/admin/blog/new">) {
  return (
    <Suspense fallback={<LoadingMain />}>
      <NewArticle searchParams={searchParams} />
    </Suspense>
  );
}

async function NewArticle({ searchParams }: { searchParams: PageProps<"/admin/blog/new">["searchParams"] }) {
  await requireAdmin("/admin/blog/new");
  const query = await searchParams;
  const error = typeof query.error === "string" ? errors[query.error] : null;
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">
      <h1 className="font-display text-4xl font-semibold tracking-tight">New article</h1>
      <div className="mt-6">
        <ArticleForm
          action={saveArticle}
          error={error}
          initial={{ title: "", slug: "", excerpt: "", category: "moving-tips", authorName: "", seoTitle: "", seoDescription: "", coverAlt: "", body: [] }}
        />
      </div>
    </main>
  );
}
