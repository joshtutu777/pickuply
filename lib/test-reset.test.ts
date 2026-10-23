import assert from "node:assert/strict";
import test from "node:test";
import { assertAllowlistedPhone, assertLocalSupabaseUrl, historyBlocksReset } from "./test-reset";

const allow = ["5555550201", "5555550123"];

test("reset refuses a hosted URL and a phone that is not allowlisted", () => {
  assert.throws(() => assertLocalSupabaseUrl("https://example.supabase.co"), /not local/);
  assert.doesNotThrow(() => assertLocalSupabaseUrl("http://127.0.0.1:54321"));
  assert.throws(() => assertAllowlistedPhone("5555550999", allow), /allowlist/);
  assert.equal(assertAllowlistedPhone("+1 555-555-0201", allow), "5555550201");
});

test("reset refuses an account that already has marketplace history", () => {
  assert.equal(
    historyBlocksReset({ jobs: 0, messages: 0, threads: 0, ledger: 0, offers: 0, disputes: 0 }),
    null,
  );
  assert.match(
    historyBlocksReset({ jobs: 1, messages: 0, threads: 0, ledger: 0, offers: 0, disputes: 0 }) ?? "",
    /fresh unused/,
  );
});
