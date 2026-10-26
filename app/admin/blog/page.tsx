import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { LoadingMain } from "@/components/loading-main";
import { requireAdmin } from "@/lib/auth/session";
import { blogDateLabel, blogPageNumber, categoryLabel } from "@/lib/blog/content";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Blog" };

const pageSize = 20;

export default function AdminBlogPage({ searchParams }: PageProps<"/admin/blog">) {
  return (
    <Suspense fallback={<LoadingMain />}>
      <AdminBlog searchParams={searchParams} />
    </Suspense>
  );
}

async function AdminBlog({ searchParams }: { searchParams: PageProps<"/admin/blog">["searchParams"] }) {
  await requireAdmin("/admin/blog");
  const query = await searchParams;
  const q = typeof query.q === "string" ? query.q.trim().slice(0, 80) : "";
  const status = query.status === "draft" || query.status === "published" ? query.status : "";
  const category = typeof query.category === "string" ? query.category : "";
  const page = blogPageNumber(typeof query.page === "string" ? query.page : undefined);
  const supabase = await createClient();
  let request = supabase
    .from("blog_posts")
    .select("id, title, category, status, published_at, updated_at", { count: "exact" })
    .order("updated_at", { ascending: false });
  if (status) request = request.eq("status", status);
  if (category) request = request.eq("category", category);
  const safeQuery = q.replace(/[^a-zA-Z0-9 ]/g, "").trim();
  if (safeQuery) request = request.ilike("title", `%${safeQuery}%`);
  const { data, count, error } = await request.range((page - 1) * pageSize, page * pageSize - 1);
  const pages = Math.max(1, Math.ceil((count ?? 0) / pageSize));
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-4xl font-semibold tracking-tight">Blog</h1>
        <Link href="/admin/blog/new" className="inline-flex min-h-12 items-center rounded-full bg-brand px-5 font-semibold text-white">
          New article
        </Link>
      </div>
      {query.deleted === "1" ? <p className="mt-4 text-base">Article deleted.</p> : null}
      <form className="mt-4 flex flex-wrap gap-2" method="get">
        <label className="sr-only" htmlFor="blog-search">Search articles</label>
        <input id="blog-search" name="q" defaultValue={q} placeholder="Search titles" className="min-h-12 flex-1 rounded-2xl border border-line bg-paper px-4" />
        <select name="status" defaultValue={status} aria-label="Status" className="min-h-12 rounded-2xl border border-line bg-paper px-3">
          <option value="">All statuses</option>
          <option value="draft">Draft</option>
          <option value="published">Published</option>
        </select>
        <select name="category" defaultValue={category} aria-label="Category" className="min-h-12 rounded-2xl border border-line bg-paper px-3">
          <option value="">All categories</option>
          <option value="moving-tips">Moving Tips</option>
          <option value="facebook-marketplace">Facebook Marketplace</option>
          <option value="furniture-delivery">Furniture Delivery</option>
          <option value="for-drivers">For Drivers</option>
          <option value="pickup-delivery-guides">Pickup & Delivery Guides</option>
          <option value="pickuply-updates">Pickuply Updates</option>
        </select>
        <button className="inline-flex min-h-12 items-center rounded-full bg-ink px-4 font-semibold text-white">Filter</button>
      </form>
      {error ? <p role="alert" className="mt-4 text-danger">Articles could not be loaded.</p> : null}
      {(data ?? []).length === 0 ? <p className="mt-6 text-base text-muted">No articles match.</p> : null}
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-base">
          <thead>
            <tr className="border-b border-line">
              <th className="py-3 pr-3">Title</th>
              <th className="py-3 pr-3">Category</th>
              <th className="py-3 pr-3">Status</th>
              <th className="py-3 pr-3">Published</th>
              <th className="py-3 pr-3">Updated</th>
              <th className="py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {(data ?? []).map((article) => (
              <tr key={article.id} className="border-b border-line">
                <td className="py-3 pr-3 font-semibold">{article.title}</td>
                <td className="py-3 pr-3">{categoryLabel(article.category)}</td>
                <td className="py-3 pr-3">{article.status === "published" ? "Published" : "Draft"}</td>
                <td className="py-3 pr-3">{blogDateLabel(article.published_at) ?? "Not published"}</td>
                <td className="py-3 pr-3">{blogDateLabel(article.updated_at) ?? ""}</td>
                <td className="py-3">
                  <Link href={`/admin/blog/${article.id}/edit`} className="font-semibold text-brand">Edit</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pages > 1 ? (
        <nav aria-label="Article pages" className="mt-4 flex gap-3">
          {page > 1 ? <Link href={`/admin/blog?page=${page - 1}`} className="inline-flex min-h-12 items-center font-semibold text-brand">Previous</Link> : null}
          <span className="inline-flex min-h-12 items-center">Page {page} of {pages}</span>
          {page < pages ? <Link href={`/admin/blog?page=${page + 1}`} className="inline-flex min-h-12 items-center font-semibold text-brand">Next</Link> : null}
        </nav>
      ) : null}
    </main>
  );
}
