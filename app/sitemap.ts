import type { MetadataRoute } from "next";
import { connection } from "next/server";
import { publicSiteUrl } from "@/lib/blog/site";
import { createClient } from "@/lib/supabase/server";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  await connection();
  const site = publicSiteUrl();
  const pages: MetadataRoute.Sitemap = [
    { url: `${site}/`, changeFrequency: "weekly", priority: 1 },
    { url: `${site}/blog`, changeFrequency: "weekly", priority: 0.7 },
    { url: `${site}/drive`, changeFrequency: "monthly", priority: 0.5 },
    { url: `${site}/help`, changeFrequency: "monthly", priority: 0.4 },
  ];
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
