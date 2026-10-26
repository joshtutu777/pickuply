export const blogCategories = [
  { id: "moving-tips", label: "Moving Tips" },
  { id: "facebook-marketplace", label: "Facebook Marketplace" },
  { id: "furniture-delivery", label: "Furniture Delivery" },
  { id: "for-drivers", label: "For Drivers" },
  { id: "pickup-delivery-guides", label: "Pickup & Delivery Guides" },
  { id: "pickuply-updates", label: "Pickuply Updates" },
] as const;

export type BlogCategory = (typeof blogCategories)[number]["id"];

const categoryIds = new Set<string>(blogCategories.map((category) => category.id));

export type InlineRun = { text: string; bold?: boolean; italic?: boolean; href?: string };

export type ArticleBlock =
  | { type: "heading"; level: 2 | 3; text: string }
  | { type: "paragraph"; text: string }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "quote"; text: string }
  | { type: "image"; path: string; alt: string };

const imagePath = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$/i;
const maxBlocks = 40;
const maxText = 4000;

export function categoryLabel(id: string): string {
  return blogCategories.find((category) => category.id === id)?.label ?? "Article";
}

export function slugifyTitle(title: string): string {
  const slug = title
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
  return slug || "article";
}

export function parseInline(source: string): InlineRun[] {
  const runs: InlineRun[] = [];
  const pattern = /\*\*([^*\n]+)\*\*|\*([^*\n]+)\*|\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g;
  let last = 0;
  for (const match of source.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > last) runs.push({ text: source.slice(last, index) });
    if (match[1] != null) runs.push({ text: match[1], bold: true });
    else if (match[2] != null) runs.push({ text: match[2], italic: true });
    else if (match[3] != null && match[4] != null) runs.push({ text: match[3], href: match[4] });
    last = index + match[0].length;
  }
  if (last < source.length) runs.push({ text: source.slice(last) });
  return runs.filter((run) => run.text.length > 0);
}

export function imageKind(bytes: Uint8Array): "jpg" | "png" | "webp" | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpg";
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "png";
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "webp";
  }
  return null;
}

export function acceptImage(bytes: Uint8Array, limit = 1_500_000): { ok: true; ext: "jpg" | "png" | "webp" } | { ok: false; error: string } {
  if (bytes.length === 0) return { ok: false, error: "Choose an image." };
  if (bytes.length > limit) return { ok: false, error: "Use an image under 1.5 MB." };
  const ext = imageKind(bytes);
  if (!ext) return { ok: false, error: "Use a JPEG, PNG, or WebP image." };
  return { ok: true, ext };
}

function text(value: unknown, limit: number): string | null {
  if (typeof value !== "string") return null;
  const clean = value.replace(/\u0000/g, "").trim();
  if (clean.length > limit) return null;
  return clean;
}

export function parseBlocks(value: unknown): ArticleBlock[] | null {
  if (!Array.isArray(value) || value.length > maxBlocks) return null;
  const blocks: ArticleBlock[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") return null;
    const block = item as Record<string, unknown>;
    if (block.type === "heading") {
      const heading = text(block.text, 200);
      if (!heading || (block.level !== 2 && block.level !== 3)) return null;
      blocks.push({ type: "heading", level: block.level, text: heading });
    } else if (block.type === "paragraph" || block.type === "quote") {
      const body = text(block.text, maxText);
      if (body == null) return null;
      blocks.push(block.type === "quote" ? { type: "quote", text: body } : { type: "paragraph", text: body });
    } else if (block.type === "list") {
      if (!Array.isArray(block.items) || block.items.length === 0 || block.items.length > 20) return null;
      const items: string[] = [];
      for (const entry of block.items) {
        const line = text(entry, 300);
        if (!line) return null;
        items.push(line);
      }
      blocks.push({ type: "list", ordered: block.ordered === true, items });
    } else if (block.type === "image") {
      const path = text(block.path, 120);
      const alt = text(block.alt, 180);
      if (!path || !imagePath.test(path) || !alt) return null;
      blocks.push({ type: "image", path, alt });
    } else {
      return null;
    }
  }
  return blocks;
}

export function parseArticleFields(input: {
  title: string;
  slug: string;
  excerpt: string;
  category: string;
  authorName: string;
  seoTitle: string;
  seoDescription: string;
  coverAlt: string;
  body: unknown;
}): { ok: true; value: {
  title: string;
  slug: string;
  excerpt: string;
  category: BlogCategory;
  authorName: string;
  seoTitle: string;
  seoDescription: string;
  coverAlt: string;
  body: ArticleBlock[];
} } | { ok: false; error: string } {
  const title = input.title.replace(/\u0000/g, "").trim();
  const slug = slugifyTitle(input.slug || input.title);
  const excerpt = input.excerpt.replace(/\u0000/g, "").trim();
  const authorName = input.authorName.replace(/\u0000/g, "").trim();
  const seoTitle = input.seoTitle.replace(/\u0000/g, "").trim();
  const seoDescription = input.seoDescription.replace(/\u0000/g, "").trim();
  const coverAlt = input.coverAlt.replace(/\u0000/g, "").trim();
  if (title.length < 1 || title.length > 160) return { ok: false, error: "Add a title under 160 characters." };
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 80) return { ok: false, error: "Use a short slug with letters, numbers, and dashes." };
  if (excerpt.length > 300) return { ok: false, error: "Keep the summary under 300 characters." };
  if (!categoryIds.has(input.category)) return { ok: false, error: "Choose a category." };
  if (authorName.length > 80) return { ok: false, error: "Keep the author name under 80 characters." };
  if (seoTitle.length > 70) return { ok: false, error: "Keep the SEO title under 70 characters." };
  if (seoDescription.length > 180) return { ok: false, error: "Keep the SEO description under 180 characters." };
  if (coverAlt.length > 180) return { ok: false, error: "Keep the cover description under 180 characters." };
  const body = parseBlocks(input.body);
  if (!body) return { ok: false, error: "The article body has a section we can't save." };
  return {
    ok: true,
    value: {
      title,
      slug,
      excerpt,
      category: input.category as BlogCategory,
      authorName,
      seoTitle,
      seoDescription,
      coverAlt,
      body,
    },
  };
}

export function blogPageNumber(value: string | undefined): number {
  const page = Number(value ?? "1");
  if (!Number.isInteger(page) || page < 1) return 1;
  return Math.min(page, 100);
}

export function blogDateLabel(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}
