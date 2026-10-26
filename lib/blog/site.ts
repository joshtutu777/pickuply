export function publicSiteUrl(): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");
  return "https://pickuplyapp.com";
}

export function articlePath(slug: string): string {
  return `/blog/${slug}`;
}

export function articleImageSrc(postId: string, path: string): string {
  const file = path.split("/").at(-1) ?? "";
  return `/blog/media/${postId}/${file}`;
}
