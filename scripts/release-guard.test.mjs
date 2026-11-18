import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  approvedReleaseAt,
  commitContains,
  databaseChangesAllowed,
  evaluateRelease,
  loadApprovedRelease,
  loadProductionRecord,
  loadReleasePolicy,
  readCommit,
  repositoryName,
  verifyGithubBranch,
} from "./release-guard.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const policy = loadReleasePolicy();
const mobileUx = "5da7fcc5327aebc79542bd0118af179d8fd48047";
const oldMain = "8fddccd745a3ad7e46032f0c0bc768460e9c6fea";
const remote = "https://github.com/joshtutu777/pickuply.git";

function releaseOf(sha, patch = {}) {
  const commit = readCommit(root, sha);
  assert.ok(commit, `${sha} is not available locally`);
  return {
    policy,
    remoteUrl: remote,
    branch: policy.productionBranch,
    status: "",
    files: commit.files,
    baselineMigrations: commit.migrations,
    releaseMigrations: commit.migrations,
    migrationsApproved: false,
    record: {
      deploymentId: "dpl_test",
      sha,
      readyState: "READY",
      target: "production",
      aliases: [policy.productionHost],
    },
    approved: {
      repository: policy.repository,
      branch: policy.productionBranch,
      sha,
      deploymentId: "dpl_test",
    },
    previousApproved: null,
    githubFailures: [],
    ancestor: true,
    ...patch,
  };
}

test("repository names accept both GitHub URL shapes", () => {
  assert.equal(repositoryName("https://github.com/joshtutu777/pickuply.git"), policy.repository);
  assert.equal(repositoryName("git@github.com:joshtutu777/pickuply.git"), policy.repository);
  assert.equal(policy.sha, undefined);
});

test("A stale release/mobile-ux is not a descendant of production", () => {
  const production = readCommit(root, "HEAD");
  assert.equal(commitContains(root, production.sha, mobileUx), false);
  const result = evaluateRelease(
    releaseOf(production.sha, {
      branch: "release/mobile-ux",
      ancestor: false,
      files: readCommit(root, mobileUx).files,
    }),
  );
  assert.equal(result.ok, false);
  assert.ok(result.failures.some((failure) => failure.includes("does not contain")));
  assert.ok(result.failures.some((failure) => failure.includes("release/mobile-ux")));
});

test("B old GitHub main is not a descendant of production", () => {
  const production = readCommit(root, "HEAD");
  assert.equal(commitContains(root, production.sha, oldMain), false);
  const result = evaluateRelease(
    releaseOf(production.sha, { branch: "main", ancestor: false, files: readCommit(root, oldMain).files }),
  );
  assert.equal(result.ok, false);
  assert.ok(result.failures.some((failure) => failure.includes("does not contain")));
});

test("C a dirty working tree is refused", () => {
  const result = evaluateRelease(releaseOf(readCommit(root, "HEAD").sha, { status: " M app/driver/page.tsx" }));
  assert.equal(result.ok, false);
  assert.deepEqual(
    result.failures.filter((failure) => failure.includes("uncommitted")),
    ["working tree has uncommitted changes"],
  );
});

test("D a commit that lacks the production baseline is refused", () => {
  const result = evaluateRelease(releaseOf(readCommit(root, "HEAD").sha, { ancestor: false }));
  assert.equal(result.ok, false);
  assert.ok(result.failures.includes("release does not contain the current production commit"));
});

test("E unexpected migration changes are refused", () => {
  const commit = readCommit(root, "HEAD");
  const added = evaluateRelease(
    releaseOf(commit.sha, {
      releaseMigrations: [...commit.migrations, { path: "supabase/migrations/0199_new.sql", oid: "abc" }],
    }),
  );
  assert.equal(added.ok, false);
  assert.ok(added.failures.some((failure) => failure.includes("new migration files block the release")));

  const flagged = evaluateRelease(
    releaseOf(commit.sha, {
      migrationsApproved: true,
      releaseMigrations: [...commit.migrations, { path: "supabase/migrations/0199_new.sql", oid: "abc" }],
    }),
  );
  assert.equal(flagged.ok, false);
  assert.equal(databaseChangesAllowed(), false);
  assert.ok(flagged.failures.includes("RELEASE_MIGRATIONS does not authorize production database changes"));

  const rewritten = commit.migrations.map((entry, index) => (index === 0 ? { ...entry, oid: "rewritten" } : entry));
  const edited = evaluateRelease(releaseOf(commit.sha, { releaseMigrations: rewritten, migrationsApproved: true }));
  assert.equal(edited.ok, false);
  assert.ok(edited.failures.some((failure) => failure.startsWith("migration rewritten:")));

  const removed = evaluateRelease(
    releaseOf(commit.sha, { releaseMigrations: commit.migrations.slice(1), migrationsApproved: true }),
  );
  assert.equal(removed.ok, false);
  assert.ok(removed.failures.some((failure) => failure.startsWith("migration removed:")));
});

test("F a missing required route is refused", () => {
  const commit = readCommit(root, "HEAD");
  const result = evaluateRelease(
    releaseOf(commit.sha, { files: commit.files.filter((file) => file !== "app/admin/sms/page.tsx") }),
  );
  assert.equal(result.ok, false);
  assert.ok(result.failures.some((failure) => failure.includes("/admin/sms")));
});

test("G a missing or unverifiable production SHA is refused", () => {
  const commit = readCommit(root, "HEAD");
  const missing = evaluateRelease(releaseOf(commit.sha, { record: null, ancestor: null, baselineMigrations: null }));
  assert.equal(missing.ok, false);
  assert.ok(missing.failures.includes("production deployment could not be verified"));

  const noSha = evaluateRelease(
    releaseOf(commit.sha, {
      record: { deploymentId: "dpl_test", sha: "", readyState: "READY", target: "production", aliases: ["pickuplyapp.com"] },
      ancestor: null,
    }),
  );
  assert.equal(noSha.ok, false);
  assert.ok(noSha.failures.includes("production deployment has no commit SHA"));

  const wrongSite = evaluateRelease(
    releaseOf(commit.sha, {
      record: {
        deploymentId: "dpl_test",
        sha: commit.sha,
        readyState: "READY",
        target: "production",
        aliases: ["preview.example"],
      },
    }),
  );
  assert.equal(wrongSite.ok, false);
  assert.ok(wrongSite.failures.some((failure) => failure.includes("pickuplyapp.com")));
});

test("a live deployment that differs from the approved record is refused", () => {
  const commit = readCommit(root, "HEAD");
  const result = evaluateRelease(
    releaseOf(commit.sha, {
      record: {
        deploymentId: "dpl_otherdeploy",
        sha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        readyState: "READY",
        target: "production",
        aliases: [policy.productionHost],
      },
    }),
  );
  assert.equal(result.ok, false);
  assert.ok(result.failures.includes("production deployment SHA does not match the approved release record"));
});

test("an unapproved Vercel deployment cannot replace the approved baseline", () => {
  const commit = readCommit(root, "HEAD");
  const movedSha = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const result = evaluateRelease(
    releaseOf(commit.sha, {
      previousApproved: {
        repository: policy.repository,
        branch: policy.productionBranch,
        sha: commit.sha,
        deploymentId: "dpl_test",
      },
      approved: {
        repository: policy.repository,
        branch: policy.productionBranch,
        sha: movedSha,
        deploymentId: "dpl_newdeploy",
      },
      record: {
        deploymentId: "dpl_newdeploy",
        sha: movedSha,
        readyState: "READY",
        target: "production",
        aliases: [policy.productionHost],
      },
    }),
  );
  assert.equal(result.ok, false);
  assert.ok(result.failures.includes("approved production baseline changed"));
});

test("GitHub verification failure blocks the release", () => {
  const result = evaluateRelease(
    releaseOf(readCommit(root, "HEAD").sha, { githubFailures: ["GitHub branch could not be verified"] }),
  );
  assert.equal(result.ok, false);
  assert.ok(result.failures.includes("GitHub branch could not be verified"));
});

test("the current production commit passes source and ancestry checks", { timeout: 90_000 }, () => {
  const approved = loadApprovedRelease();
  const record = loadProductionRecord(policy);
  assert.ok(record, "production deployment could not be verified");
  assert.equal(approved.sha, "7d125c3f1f3c533791e60bcd6c102beb0464dd7b");
  assert.equal(approved.deploymentId, "dpl_C8kdECPddNNgH9nxWzFwZLgWE77G");
  assert.equal(record.sha, approved.sha);
  assert.equal(record.deploymentId, approved.deploymentId);
  const commit = readCommit(root, record.sha);
  assert.ok(commit, "production commit is not available locally");
  const head = readCommit(root, "HEAD");
  const githubFailures = verifyGithubBranch(root, policy.productionBranch, approved.sha, head.sha);
  const result = evaluateRelease(
    releaseOf(head.sha, {
      record,
      approved,
      previousApproved: approvedReleaseAt(root, "HEAD^"),
      githubFailures,
      ancestor: commitContains(root, approved.sha, head.sha),
      baselineMigrations: commit.migrations,
      releaseMigrations: head.migrations,
      files: head.files,
    }),
  );
  assert.deepEqual(result.failures, []);
  assert.equal(result.ok, true);
  assert.equal(commitContains(root, approved.sha, head.sha), true);
  for (const route of policy.requiredRoutes) assert.ok(head.files.includes(route.file), route.route);
  assert.deepEqual(
    policy.regressionTests,
    [
      "lib/auth/access.test.ts",
      "lib/driver/feed-card.test.ts",
      "lib/driver/offer-gate.test.ts",
      "lib/validation/request.test.ts",
      "lib/sms/center.test.ts",
      "lib/admin/lead-metrics.test.ts",
      "lib/payments/stripe-mode.test.ts",
    ],
  );
});

test("the guard command refuses this dirty worktree without deploying", { timeout: 90_000 }, () => {
  let thrown = null;
  try {
    execFileSync(process.execPath, ["scripts/release-guard.mjs"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    thrown = error;
  }
  assert.ok(thrown, "the dirty worktree was accepted");
  assert.equal(thrown.status, 1);
  const output = `${thrown.stdout ?? ""}\n${thrown.stderr ?? ""}`;
  if (!output.includes("uncommitted changes")) throw new Error("dirty tree was not the refusal reason");
  if (output.includes("vercel deploy")) throw new Error("the guard tried to deploy");
});
