"use server";

import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth/session";
import { parseArticleFields, parseBlocks } from "@/lib/blog/content";
import { readImageFile, storeBlogImage } from "@/lib/blog/save";
import { createClient } from "@/lib/supabase/server";

function text(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value : "";
}

export async function saveArticle(form: FormData) {
  const session = await requireAdmin("/admin/blog");
  const supabase = await createClient();
  const idValue = text(form, "id");
  const back = idValue ? `/admin/blog/${idValue}/edit` : "/admin/blog/new";
  let body: unknown = [];
  try {
    body = JSON.parse(text(form, "body") || "[]");
  } catch {
    redirect(`${back}?error=body`);
  }
  const image = await readImageFile(form.get("cover"));
  if (image && "error" in image) redirect(`${back}?error=image`);
  const parsed = parseArticleFields({
    title: text(form, "title"),
    slug: text(form, "slug"),
    excerpt: text(form, "excerpt"),
    category: text(form, "category"),
    authorName: text(form, "authorName"),
    seoTitle: text(form, "seoTitle"),
    seoDescription: text(form, "seoDescription"),
    coverAlt: text(form, "coverAlt"),
    body,
  });
  if (!parsed.ok) redirect(`${back}?error=fields`);
  const intent = text(form, "intent");
  const status = intent === "publish" ? "published" : "draft";
  const row = {
    title: parsed.value.title,
    slug: parsed.value.slug,
    excerpt: parsed.value.excerpt,
    category: parsed.value.category,
    author_name: parsed.value.authorName,
    seo_title: parsed.value.seoTitle,
    seo_description: parsed.value.seoDescription,
    cover_alt: parsed.value.coverAlt,
    body: parsed.value.body,
    status,
    created_by: session.userId,
  };
  const saved = idValue
    ? await supabase.from("blog_posts").update(row).eq("id", idValue).select("id").maybeSingle()
    : await supabase.from("blog_posts").insert(row).select("id").maybeSingle();
  if (saved.error || !saved.data) redirect(`${back}?error=save`);
  const id = saved.data.id as string;
  if (image && "bytes" in image) {
    const stored = await storeBlogImage(supabase, id, image.bytes, image.ext);
    if ("error" in stored) redirect(`/admin/blog/${id}/edit?error=image`);
    await supabase.from("blog_posts").update({ cover_path: stored.path }).eq("id", id);
  }
  await supabase.from("audit_log").insert({
    actor_id: session.userId,
    action: status === "published" ? "blog_publish" : "blog_save",
    target_type: "blog_post",
    target_id: id,
    data: { slug: parsed.value.slug },
  });
  if (intent === "preview") redirect(`/admin/blog/${id}/preview`);
  redirect(`/admin/blog/${id}/edit?saved=1`);
}

export async function unpublishArticle(form: FormData) {
  const session = await requireAdmin("/admin/blog");
  const id = text(form, "id");
  const supabase = await createClient();
  const saved = await supabase.from("blog_posts").update({ status: "draft" }).eq("id", id).select("slug").maybeSingle();
  if (saved.error || !saved.data) redirect(`/admin/blog/${id}/edit?error=save`);
  await supabase.from("audit_log").insert({
    actor_id: session.userId,
    action: "blog_unpublish",
    target_type: "blog_post",
    target_id: id,
    data: { slug: saved.data.slug },
  });
  redirect(`/admin/blog/${id}/edit?saved=1`);
}

export async function deleteArticle(form: FormData) {
  const session = await requireAdmin("/admin/blog");
  const id = text(form, "id");
  const supabase = await createClient();
  const existing = await supabase.from("blog_posts").select("slug, cover_path, body").eq("id", id).maybeSingle();
  if (!existing.data) redirect("/admin/blog?error=missing");
  const blocks = parseBlocks(existing.data.body) ?? [];
  const paths = [existing.data.cover_path, ...blocks.flatMap((block) => (block.type === "image" ? [block.path] : []))].filter(
    (path): path is string => Boolean(path),
  );
  if (paths.length > 0) await supabase.storage.from("blog-images").remove(paths);
  const removed = await supabase.from("blog_posts").delete().eq("id", id);
  if (removed.error) redirect(`/admin/blog/${id}/edit?error=save`);
  await supabase.from("audit_log").insert({
    actor_id: session.userId,
    action: "blog_delete",
    target_type: "blog_post",
    target_id: id,
    data: { slug: existing.data.slug },
  });
  redirect("/admin/blog?deleted=1");
}
