import Link from "next/link";
import { ArticleBody } from "@/components/blog/article-body";
import { blogDateLabel, categoryLabel, type ArticleBlock } from "@/lib/blog/content";
import { articleImageSrc } from "@/lib/blog/site";

export function ArticleView({
  postId,
  title,
  excerpt,
  category,
  publishedAt,
  authorName,
  coverPath,
  coverAlt,
  blocks,
  preview = false,
}: {
  postId: string;
  title: string;
  excerpt: string;
  category: string;
  publishedAt: string | null;
  authorName: string;
  coverPath: string | null;
  coverAlt: string;
  blocks: ArticleBlock[];
  preview?: boolean;
}) {
  const date = blogDateLabel(publishedAt);
  return (
    <article className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">
      {preview ? (
        <p className="rounded-2xl bg-paper-raised p-3 text-base font-semibold">Admin preview. Visitors only see a published article.</p>
      ) : null}
      <p className="mt-4 text-sm font-semibold tracking-wide text-brand uppercase">{categoryLabel(category)}</p>
      <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight text-ink">{title}</h1>
      {excerpt ? <p className="mt-3 text-lg text-muted">{excerpt}</p> : null}
      <p className="mt-3 text-base text-muted">
        {date ? date : null}
        {date && authorName ? " · " : null}
        {authorName ? authorName : null}
      </p>
      {coverPath ? (
        <img src={articleImageSrc(postId, coverPath)} alt={coverAlt || ""} className="mt-6 aspect-video w-full rounded-3xl object-cover" />
      ) : null}
      <div className="mt-6">
        <ArticleBody postId={postId} blocks={blocks} />
      </div>
      <p className="mt-8">
        <Link href="/blog" className="inline-flex min-h-12 items-center font-semibold text-brand">
          All articles
        </Link>
      </p>
    </article>
  );
}
