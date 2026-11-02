import type { MetadataRoute } from "next";
import { connection } from "next/server";
import { publicIndexPaths, siteUrl } from "@/lib/seo";
import { createClient } from "@/lib/supabase/server";

const priority: Record<(typeof publicIndexPaths)[number], number> = {
  "/": 1,
  "/request": 0.9,
  "/drive": 0.7,
  "/contact": 0.5,
  "/blog": 0.6,
  "/terms": 0.3,
  "/privacy": 0.3,
  "/terms/driver": 0.3,
};

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  await connection();
  const site = siteUrl;
  const pages: MetadataRoute.Sitemap = publicIndexPaths.map((path) => ({
    url: path === "/" ? `${site}/` : `${site}${path}`,
    changeFrequency: path === "/" || path === "/blog" ? "weekly" : "monthly",
    priority: priority[path],
  }));
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from("blog_posts")
      .select("slug, updated_at")
      .eq("status", "published")
      .order("published_at", { ascending: false })
      .limit(200);
    for (const article of data ?? []) {
      pages.push({
        url: `${site}/blog/${article.slug}`,
        lastModified: article.updated_at,
        changeFrequency: "monthly",
        priority: 0.6,
      });
    }
  } catch {
    return pages;
  }
  return pages;
}
