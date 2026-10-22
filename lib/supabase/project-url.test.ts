import assert from "node:assert/strict";
import test from "node:test";
import { supabaseProjectUrl } from "./project-url";

test("a project origin is unchanged", () => {
  assert.equal(supabaseProjectUrl("https://example.supabase.co"), "https://example.supabase.co");
  assert.equal(supabaseProjectUrl("https://example.supabase.co/"), "https://example.supabase.co");
});

test("a copied Data API path is removed", () => {
  assert.equal(
    supabaseProjectUrl("https://example.supabase.co/rest/v1"),
    "https://example.supabase.co",
  );
  assert.equal(
    supabaseProjectUrl("https://example.supabase.co/rest/v1/"),
    "https://example.supabase.co",
  );
});
