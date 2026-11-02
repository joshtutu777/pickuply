import assert from "node:assert/strict";
import test from "node:test";
import { privatePathPrefixes, publicIndexPaths, siteStructuredData, siteUrl } from "./seo";

test("public pages stay separate from private app screens", () => {
  for (const path of publicIndexPaths) {
    assert.equal(path.startsWith("/"), true);
    assert.equal(
      privatePathPrefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`)),
      false,
      path,
    );
  }
  const paths: readonly string[] = publicIndexPaths;
  assert.equal(paths.includes("/help"), false);
  assert.equal(paths.includes("/login"), false);
  assert.equal(paths.includes("/jobs"), false);
  assert.equal(paths.includes("/"), true);
  assert.equal(paths.includes("/drive"), true);
});

test("structured data uses the production site and published business details", () => {
  const data = siteStructuredData();
  const graph = data["@graph"] as Array<Record<string, unknown>>;
  assert.equal(graph.some((item) => item["@type"] === "Organization"), true);
  assert.equal(graph.some((item) => item["@type"] === "WebSite"), true);
  assert.equal(JSON.stringify(data).includes(siteUrl), true);
  assert.equal(JSON.stringify(data).includes("info@pickuplyapp.com"), true);
  assert.equal(JSON.stringify(data).includes("1985 Chattahoochee Dr"), true);
});
