import assert from "node:assert/strict";
import test from "node:test";
import { acceptImage, articleStatus, blogDateLabel, droppedImagePaths, keptSlugs, parseArticleFields, parseBlocks, parseInline, referencedImagePaths, slugifyTitle } from "./content";

test("a title becomes a readable slug", () => {
  assert.equal(slugifyTitle("Facebook Marketplace Finds!"), "facebook-marketplace-finds");
});

test("article text keeps script tags as text and allows only web links", () => {
  const runs = parseInline('Hello <script>alert(1)</script> **bold** and [site](javascript:alert(1)) [ok](https://pickuplyapp.com)');
  assert.equal(runs.some((run) => run.href?.startsWith("javascript:")), false);
  assert.equal(runs.some((run) => run.text.includes("<script>")), true);
  assert.equal(runs.find((run) => run.bold)?.text, "bold");
  assert.equal(runs.find((run) => run.href)?.href, "https://pickuplyapp.com");
});

test("a block image needs a real alt and a private path", () => {
  assert.equal(parseBlocks([{ type: "image", path: "../secret.png", alt: "Couch" }]), null);
  assert.equal(parseBlocks([{ type: "image", path: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.png", alt: "" }]), null);
  const saved = parseBlocks([
    { type: "image", path: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.png", alt: "Couch" },
  ]);
  assert.equal(saved?.[0]?.type, "image");
});

test("article fields reject a missing category and an oversized title", () => {
  const bad = parseArticleFields({
    title: "x".repeat(161),
    slug: "",
    excerpt: "",
    category: "news",
    authorName: "",
    seoTitle: "",
    seoDescription: "",
    coverAlt: "",
    body: [],
  });
  assert.equal(bad.ok, false);
});

test("image bytes must match a photo format and stay under the limit", () => {
  assert.equal(acceptImage(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0])).ok, true);
  assert.equal(acceptImage(Uint8Array.from([0x3c, 0x73, 0x63, 0x72, 0x69, 0x70, 0x74])).ok, false);
  assert.equal(acceptImage(new Uint8Array(1_500_001)).ok, false);
});

test("a title change keeps the published address unless the slug is edited", () => {
  assert.deepEqual(keptSlugs(["older"], "sofa-guide", "sofa-guide", true), ["older"]);
  assert.deepEqual(keptSlugs([], "sofa-guide", "new-sofa-guide", true), ["sofa-guide"]);
  assert.deepEqual(keptSlugs([], "draft-title", "draft-title-2", false), []);
});

test("replacing a cover drops only the old file", () => {
  const before = referencedImagePaths("post/old.png", []);
  const after = referencedImagePaths("post/new.png", []);
  assert.deepEqual(droppedImagePaths(before, after), ["post/old.png"]);
});

test("saving a published article does not turn it into a draft", () => {
  assert.equal(articleStatus("save", "published"), "published");
  assert.equal(articleStatus("draft", "published"), "draft");
  assert.equal(articleStatus("publish", "draft"), "published");
});

test("a missing publication date is not invented", () => {
  assert.equal(blogDateLabel(null), null);
  assert.equal(blogDateLabel("2026-10-27T18:30:00.000Z"), "Oct 27, 2026");
});
