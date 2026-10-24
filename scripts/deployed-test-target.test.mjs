import assert from "node:assert/strict";
import test from "node:test";
import { assertSafeTestTarget, deployedTestPhones, productionSupabaseHost } from "./deployed-test-target.mjs";

test("production Supabase is refused", () => {
  assert.throws(
    () => assertSafeTestTarget(`https://${productionSupabaseHost}`),
    /production Supabase/,
  );
});

test("any other hosted project is refused", () => {
  assert.throws(() => assertSafeTestTarget("https://abcdefghijklmnopqrst.supabase.co"), /local Supabase only/);
});

test("local API is allowed and the roster avoids reserved numbers", () => {
  assert.equal(assertSafeTestTarget("http://127.0.0.1:54321"), "127.0.0.1:54321");
  assert.equal(deployedTestPhones.length, 13);
  for (const phone of deployedTestPhones) {
    assert.equal(/^55555503(0[1-9]|1[0-3])$/.test(phone), true);
    assert.equal(Number(phone) >= 5555550201 && Number(phone) <= 5555550205, false);
  }
});
