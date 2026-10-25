import assert from "node:assert/strict";
import test from "node:test";
import { assertSafeTestTarget } from "./deployed-test-target.mjs";
import { hostedRosterClaimFreshSql, hostedRosterCleanupSql, hostedRosterPrecheckSql } from "./hosted-test-accounts-sql.mjs";
import {
  assertHostedTestApproval,
  assertHostedTestTarget,
  hostedTestProjectHost,
  hostedTestProjectRef,
} from "./hosted-test-guard.mjs";

test("the local guard still refuses the hosted project", () => {
  assert.throws(
    () => assertSafeTestTarget(`https://${hostedTestProjectHost}`),
    /production Supabase/,
  );
});

test("hosted provision stays off without the exact project flag", () => {
  assert.throws(() => assertHostedTestApproval(["node", "script"]), /exact approval flag/);
  assert.throws(
    () => assertHostedTestApproval(["--approve-hosted-test-accounts=otherproject123456"]),
    /does not match/,
  );
  assert.throws(
    () => assertHostedTestApproval(["--approve-hosted-test-accounts"]),
    /does not match/,
  );
});

test("the exact flag allows one action on the approved project", () => {
  assert.deepEqual(
    assertHostedTestApproval([`--approve-hosted-test-accounts=${hostedTestProjectRef}`]),
    { action: "provision", ref: hostedTestProjectRef },
  );
  assert.deepEqual(
    assertHostedTestApproval([`--approve-hosted-test-cleanup=${hostedTestProjectRef}`]),
    { action: "cleanup", ref: hostedTestProjectRef },
  );
  assert.throws(
    () => assertHostedTestApproval([
      `--approve-hosted-test-accounts=${hostedTestProjectRef}`,
      `--approve-hosted-test-cleanup=${hostedTestProjectRef}`,
    ]),
    /not both/,
  );
});

test("cleanup and precheck only touch test rows", () => {
  const precheck = hostedRosterPrecheckSql();
  const cleanup = hostedRosterCleanupSql();
  assert.match(precheck, /is_test is distinct from true/);
  assert.match(precheck, /5555550301/);
  assert.match(precheck, /5555550313/);
  assert.match(cleanup, /is_test = true/);
  assert.match(cleanup, /refusing: cleanup found a real profile/);
  assert.doesNotMatch(cleanup, /payouts_enabled = true/);
  const claim = hostedRosterClaimFreshSql();
  assert.match(claim, /full_name is null/);
  assert.match(claim, /role = 'customer'/);
  assert.match(claim, /not exists/);
  assert.match(claim, /refusing: a roster phone belongs to a real profile/);
  assert.doesNotMatch(claim, /set role/);
});
test("a matching flag still refuses a different URL", () => {
  assert.equal(
    assertHostedTestTarget(`https://${hostedTestProjectHost}`, hostedTestProjectRef),
    hostedTestProjectHost,
  );
  assert.throws(
    () => assertHostedTestTarget("https://abcdefghijklmnopqrst.supabase.co", hostedTestProjectRef),
    /approved project/,
  );
  assert.throws(
    () => assertHostedTestTarget(`https://${hostedTestProjectHost}`, "otherproject123456"),
    /approved project/,
  );
});
