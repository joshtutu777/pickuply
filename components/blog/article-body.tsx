import { parseInline, type ArticleBlock } from "@/lib/blog/content";
import { articleImageSrc } from "@/lib/blog/site";

function Runs({ text }: { text: string }) {
  const runs = parseInline(text);
  if (runs.length === 0) return null;
  return (
    <>
      {runs.map((run, index) => {
        const content = run.bold ? <strong>{run.text}</strong> : run.italic ? <em>{run.text}</em> : run.text;
        if (run.href) {
          return (
            <a key={index} href={run.href} className="font-semibold text-brand underline">
              {content}
            </a>
          );
        }
        return <span key={index}>{content}</span>;
      })}
    </>
  );
}

export function ArticleBody({ postId, blocks }: { postId: string; blocks: ArticleBlock[] }) {
  return (
    <div className="grid gap-4 text-lg leading-relaxed text-ink">
      {blocks.map((block, index) => {
        if (block.type === "heading") {
          const Tag = block.level === 2 ? "h2" : "h3";
          return (
            <Tag key={index} className="font-display text-3xl font-semibold tracking-tight">
              {block.text}
            </Tag>
          );
        }
        if (block.type === "quote") {
          return (
            <blockquote key={index} className="border-l-4 border-brand pl-4 text-xl">
              <Runs text={block.text} />
            </blockquote>
          );
        }
        if (block.type === "list") {
          const Tag = block.ordered ? "ol" : "ul";
          return (
            <Tag key={index} className={block.ordered ? "list-decimal space-y-2 pl-6" : "list-disc space-y-2 pl-6"}>
              {block.items.map((item) => (
                <li key={item}>
                  <Runs text={item} />
                </li>
              ))}
            </Tag>
          );
        }
        if (block.type === "image") {
          return (
            <img
              key={index}
              src={articleImageSrc(postId, block.path)}
              alt={block.alt}
              className="aspect-video w-full rounded-3xl object-cover"
            />
          );
        }
        return (
          <p key={index}>
            <Runs text={block.text} />
          </p>
        );
      })}
    </div>
  );
}
