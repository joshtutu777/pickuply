"use client";

import { useId, useState } from "react";
import { UploadPicker } from "@/components/upload-picker";
import { blogCategories, slugifyTitle, type ArticleBlock } from "@/lib/blog/content";

type Initial = {
  id?: string;
  title: string;
  slug: string;
  excerpt: string;
  category: string;
  authorName: string;
  seoTitle: string;
  seoDescription: string;
  coverAlt: string;
  body: ArticleBlock[];
  status?: "draft" | "published";
  wasPublished?: boolean;
};

export function ArticleForm({
  initial,
  action,
  error,
}: {
  initial: Initial;
  action: (formData: FormData) => void | Promise<void>;
  error?: string | null;
}) {
  const [title, setTitle] = useState(initial.title);
  const [slug, setSlug] = useState(initial.slug);
  const [slugEdited, setSlugEdited] = useState(Boolean(initial.slug));
  const [blocks, setBlocks] = useState<ArticleBlock[]>(initial.body.length > 0 ? initial.body : [{ type: "paragraph", text: "" }]);

  function changeTitle(next: string) {
    setTitle(next);
    if (!slugEdited) setSlug(slugifyTitle(next));
  }

  function update(index: number, block: ArticleBlock) {
    setBlocks((current) => current.map((item, itemIndex) => (itemIndex === index ? block : item)));
  }

  function wrapSelection(index: number, kind: "bold" | "italic" | "link") {
    const block = blocks[index];
    if (!block || (block.type !== "paragraph" && block.type !== "quote")) return;
    const field = document.getElementById(`block-${index}`) as HTMLTextAreaElement | null;
    const start = field?.selectionStart ?? block.text.length;
    const end = field?.selectionEnd ?? start;
    const selected = block.text.slice(start, end) || "text";
    const wrapped = kind === "bold" ? `**${selected}**` : kind === "italic" ? `*${selected}*` : `[${selected}](https://)`;
    const text = `${block.text.slice(0, start)}${wrapped}${block.text.slice(end)}`;
    update(index, { ...block, text });
  }

  return (
    <form action={action} className="grid gap-4">
      {initial.id ? <input type="hidden" name="id" value={initial.id} /> : null}
      <input type="hidden" name="body" value={JSON.stringify(blocks)} />
      {error ? (
        <p role="alert" className="rounded-2xl bg-paper-raised p-3 text-base text-danger">
          {error}
        </p>
      ) : null}
      <label className="grid gap-2 text-base font-semibold">
        Title
        <input name="title" value={title} onChange={(event) => changeTitle(event.target.value)} required className="min-h-12 rounded-2xl border border-line bg-paper px-4 font-normal" />
      </label>
      <label className="grid gap-2 text-base font-semibold">
        Slug
        <input
          name="slug"
          value={slug}
          onChange={(event) => {
            setSlugEdited(true);
            setSlug(event.target.value);
          }}
          required
          className="min-h-12 rounded-2xl border border-line bg-paper px-4 font-normal"
        />
        {initial.wasPublished && slug !== initial.slug ? (
          <span role="status" className="font-normal text-ink">
            Changing this address. Visitors to the old address will be sent to the new one.
          </span>
        ) : null}
      </label>
      <label className="grid gap-2 text-base font-semibold">
        Summary
        <textarea name="excerpt" defaultValue={initial.excerpt} rows={3} className="rounded-2xl border border-line bg-paper px-4 py-3 font-normal" />
      </label>
      <label className="grid gap-2 text-base font-semibold">
        Category
        <select name="category" defaultValue={initial.category || blogCategories[0].id} className="min-h-12 rounded-2xl border border-line bg-paper px-4 font-normal">
          {blogCategories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.label}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-2 text-base font-semibold">
        Author display name
        <input name="authorName" defaultValue={initial.authorName} className="min-h-12 rounded-2xl border border-line bg-paper px-4 font-normal" />
      </label>
      <UploadPicker id="cover" name="cover" accept="image/jpeg,image/png,image/webp" label="Add a cover image" kinds="JPG, PNG, or WEBP" />
      <label className="grid gap-2 text-base font-semibold">
        Cover image description
        <input name="coverAlt" defaultValue={initial.coverAlt} className="min-h-12 rounded-2xl border border-line bg-paper px-4 font-normal" />
      </label>
      <fieldset className="grid gap-3">
        <legend className="text-base font-semibold">Article body</legend>
        {blocks.map((block, index) => (
          <div key={index} className="grid gap-2 rounded-3xl bg-paper-raised p-3 ring-1 ring-line">
            <div className="flex flex-wrap gap-2">
              <button type="button" className="min-h-12 rounded-full bg-paper px-3 font-semibold" onClick={() => update(index, { type: "heading", level: 2, text: "text" in block ? block.text : "" })}>
                Heading
              </button>
              <button type="button" className="min-h-12 rounded-full bg-paper px-3 font-semibold" onClick={() => update(index, { type: "paragraph", text: "text" in block ? block.text : "" })}>
                Paragraph
              </button>
              <button type="button" className="min-h-12 rounded-full bg-paper px-3 font-semibold" onClick={() => wrapSelection(index, "bold")}>
                Bold
              </button>
              <button type="button" className="min-h-12 rounded-full bg-paper px-3 font-semibold" onClick={() => wrapSelection(index, "italic")}>
                Italic
              </button>
              <button type="button" className="min-h-12 rounded-full bg-paper px-3 font-semibold" onClick={() => wrapSelection(index, "link")}>
                Link
              </button>
              <button type="button" className="min-h-12 rounded-full bg-paper px-3 font-semibold" onClick={() => update(index, { type: "list", ordered: false, items: ["text" in block && block.text ? block.text : "Item"] })}>
                Bullets
              </button>
              <button type="button" className="min-h-12 rounded-full bg-paper px-3 font-semibold" onClick={() => update(index, { type: "list", ordered: true, items: ["text" in block && block.text ? block.text : "Item"] })}>
                Numbered
              </button>
              <button type="button" className="min-h-12 rounded-full bg-paper px-3 font-semibold" onClick={() => update(index, { type: "quote", text: "text" in block ? block.text : "" })}>
                Quote
              </button>
              <button type="button" className="min-h-12 rounded-full px-3 font-semibold text-danger" onClick={() => setBlocks((current) => current.filter((_, itemIndex) => itemIndex !== index))}>
                Remove
              </button>
            </div>
            {block.type === "list" ? (
              <label className="grid gap-2 text-sm font-semibold">
                One item per line
                <textarea
                  value={block.items.join("\n")}
                  onChange={(event) => update(index, { ...block, items: event.target.value.split("\n").filter((line) => line.trim()) })}
                  rows={4}
                  className="rounded-2xl border border-line bg-paper px-4 py-3 text-base font-normal"
                />
              </label>
            ) : block.type === "image" ? (
              <p className="text-base">Image: {block.alt}</p>
            ) : (
              <textarea
                id={`block-${index}`}
                value={block.text}
                onChange={(event) => update(index, { ...block, text: event.target.value })}
                rows={block.type === "heading" ? 2 : 5}
                className="rounded-2xl border border-line bg-paper px-4 py-3 text-base font-normal"
              />
            )}
          </div>
        ))}
        <button type="button" className="inline-flex min-h-12 items-center font-semibold text-brand" onClick={() => setBlocks((current) => [...current, { type: "paragraph", text: "" }])}>
          Add section
        </button>
        {initial.id ? (
          <BodyImageUpload
            postId={initial.id}
            onSaved={(path, alt) => setBlocks((current) => [...current, { type: "image", path, alt }])}
          />
        ) : (
          <p className="text-base text-muted">Save the draft before adding an image inside the article.</p>
        )}
      </fieldset>
      <label className="grid gap-2 text-base font-semibold">
        SEO title
        <input name="seoTitle" defaultValue={initial.seoTitle} className="min-h-12 rounded-2xl border border-line bg-paper px-4 font-normal" />
      </label>
      <label className="grid gap-2 text-base font-semibold">
        SEO description
        <textarea name="seoDescription" defaultValue={initial.seoDescription} rows={2} className="rounded-2xl border border-line bg-paper px-4 py-3 font-normal" />
      </label>
      <div className="flex flex-wrap gap-3">
        <button name="intent" value={initial.status === "published" ? "save" : "draft"} className="inline-flex min-h-12 items-center justify-center rounded-full bg-paper-raised px-5 font-semibold text-ink ring-1 ring-line">
          {initial.status === "published" ? "Save" : "Save draft"}
        </button>
        <button name="intent" value="publish" className="inline-flex min-h-12 items-center justify-center rounded-full bg-brand px-5 font-semibold text-white">
          Publish
        </button>
        {initial.id ? (
          <button name="intent" value="preview" className="inline-flex min-h-12 items-center justify-center rounded-full px-5 font-semibold text-brand">
            Preview
          </button>
        ) : null}
      </div>
    </form>
  );
}

function BodyImageUpload({ postId, onSaved }: { postId: string; onSaved: (path: string, alt: string) => void }) {
  const [alt, setAlt] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  const inputId = useId();

  async function upload(file: File) {
    const body = new FormData();
    body.set("postId", postId);
    body.set("alt", alt);
    body.set("file", file);
    const response = await fetch("/admin/blog/image", { method: "POST", body });
    const payload = (await response.json()) as { path?: string; error?: string };
    if (!response.ok || !payload.path) {
      setMessage(payload.error ?? "The image was not saved.");
      return;
    }
    onSaved(payload.path, alt);
    setAlt("");
    setMessage("Image added. Save the article to keep it.");
  }

  return (
    <div className="grid gap-2 rounded-3xl bg-paper p-3 ring-1 ring-line">
      <label className="grid gap-2 text-base font-semibold">
        Image description
        <input value={alt} onChange={(event) => setAlt(event.target.value)} className="min-h-12 rounded-2xl border border-line bg-paper px-4 font-normal" />
      </label>
      <UploadPicker
        id={inputId}
        accept="image/jpeg,image/png,image/webp"
        label="Add an image"
        kinds="JPG, PNG, or WEBP"
        clearAfter
        onChange={(files) => {
          const file = files?.[0];
          if (file) void upload(file);
        }}
      />
      {message ? <p className="text-base">{message}</p> : null}
    </div>
  );
}
