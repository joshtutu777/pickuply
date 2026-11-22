import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  approvedReleaseAt,
  commitContains,
  databaseChangesAllowed,
  evaluateRecordAdvance,
  evaluateRelease,
  landingMigrationApplied,
  loadApprovedRelease,
  loadDotEnv,
  readLandingLoadApplied,
  loadProductionRecord,
  productionDeploymentsFromApi,
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

test("a production list keeps each deployment and fails closed when a detail is missing", () => {
  const list = { deployments: [{ uid: "dpl_olddeploy", target: "production", readyState: "READY" }] };
  const details = new Map([
    ["dpl_olddeploy", { id: "dpl_olddeploy", readyState: "READY", target: "production", meta: { gitCommitSha: "b".repeat(40) } }],
  ]);
  assert.deepEqual(productionDeploymentsFromApi(list, details), [
    { deploymentId: "dpl_olddeploy", sha: "b".repeat(40), readyState: "READY", target: "production" },
  ]);
  assert.equal(productionDeploymentsFromApi(list, new Map()), null);
});

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

test("E2 only the reviewed landing migration can pass, and only after it is applied", () => {
  const commit = readCommit(root, "58779556a9205a2982ffc7df00a56b223a420491");
  const reviewed = { path: "supabase/migrations/0145_landing_load_counts.sql", oid: "reviewed" };
  const blocked = evaluateRelease(
    releaseOf(commit.sha, {
      baselineMigrations: commit.migrations,
      releaseMigrations: [...commit.migrations, reviewed],
      landingLoadApplied: false,
    }),
  );
  assert.equal(blocked.ok, false);
  assert.ok(blocked.failures.some((failure) => failure.includes("0145_landing_load_counts.sql")));

  const allowed = evaluateRelease(
    releaseOf(commit.sha, {
      baselineMigrations: commit.migrations,
      releaseMigrations: [...commit.migrations, reviewed],
      landingLoadApplied: true,
    }),
  );
  assert.equal(allowed.failures.some((failure) => failure.includes("new migration files")), false);

  const extra = evaluateRelease(
    releaseOf(commit.sha, {
      baselineMigrations: commit.migrations,
      releaseMigrations: [...commit.migrations, reviewed, { path: "supabase/migrations/0199_new.sql", oid: "abc" }],
      landingLoadApplied: true,
    }),
  );
  assert.equal(extra.ok, false);
  assert.ok(extra.failures.some((failure) => failure.includes("0199_new.sql")));
  assert.equal(extra.failures.some((failure) => failure.includes("0145_landing_load_counts.sql")), false);
  assert.equal(databaseChangesAllowed(), false);
  assert.equal(
    landingMigrationApplied({
      tableStatus: 200,
      tableIsArray: true,
      specStatus: 200,
      functionExposed: true,
      minuteTableExposed: true,
    }),
    true,
  );
  assert.equal(landingMigrationApplied({ tableStatus: 404, tableIsArray: false, specStatus: 200, functionExposed: false, minuteTableExposed: false }), false);
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

test("a verified record update is still refused by the release guard", () => {
  const previousSha = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  const nextSha = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const previousApproved = {
    repository: policy.repository,
    branch: "feat/admin-lead-analytics",
    sha: previousSha,
    deploymentId: "dpl_olddeploy",
  };
  const approved = {
    repository: policy.repository,
    branch: policy.productionBranch,
    sha: nextSha,
    deploymentId: "dpl_newdeploy",
  };
  const record = {
    deploymentId: "dpl_newdeploy",
    sha: nextSha,
    readyState: "READY",
    target: "production",
    aliases: [policy.productionHost],
  };
  const advance = evaluateRecordAdvance({
    policy,
    previousApproved,
    approved,
    record,
    containsPrevious: true,
    changedPaths: ["scripts/approved-release.json"],
  });
  assert.deepEqual(advance.failures, []);
  const release = evaluateRelease(
    releaseOf(readCommit(root, "HEAD").sha, {
      previousApproved,
      approved,
      record,
      ancestor: true,
    }),
  );
  assert.equal(release.ok, false);
  assert.ok(release.failures.includes("approved production baseline changed"));
});

test("the record check refuses application, guard, and migration changes", () => {
  const previousSha = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  const nextSha = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const base = {
    policy,
    previousApproved: {
      repository: policy.repository,
      branch: policy.productionBranch,
      sha: previousSha,
      deploymentId: "dpl_olddeploy",
    },
    approved: {
      repository: policy.repository,
      branch: policy.productionBranch,
      sha: nextSha,
      deploymentId: "dpl_newdeploy",
    },
    record: {
      deploymentId: "dpl_newdeploy",
      sha: nextSha,
      readyState: "READY",
      target: "production",
      aliases: [policy.productionHost],
    },
    containsPrevious: true,
    changedPaths: ["scripts/approved-release.json"],
  };
  assert.deepEqual(evaluateRecordAdvance(base).failures, []);
  for (const path of ["lib/payments/transfers.ts", "scripts/release-guard.mjs", "supabase/migrations/0199_new.sql"]) {
    const result = evaluateRecordAdvance({ ...base, changedPaths: ["scripts/approved-release.json", path] });
    assert.equal(result.ok, false, path);
    assert.ok(result.failures.includes("production record update changes more than the approved release record"), path);
  }
  const release = evaluateRelease(
    releaseOf(readCommit(root, "HEAD").sha, {
      previousApproved: base.previousApproved,
      approved: base.approved,
      record: base.record,
      ancestor: true,
    }),
  );
  assert.equal(release.ok, false);
  assert.ok(release.failures.includes("approved production baseline changed"));
});

test("the record check refuses a deployment that is missing, unfinished, or for another site", () => {
  const previousSha = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  const nextSha = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const approved = {
    repository: policy.repository,
    branch: policy.productionBranch,
    sha: nextSha,
    deploymentId: "dpl_newdeploy",
  };
  const previousApproved = {
    repository: policy.repository,
    branch: policy.productionBranch,
    sha: previousSha,
    deploymentId: "dpl_olddeploy",
  };
  const ready = {
    deploymentId: "dpl_newdeploy",
    sha: nextSha,
    readyState: "READY",
    target: "production",
    aliases: [policy.productionHost],
  };
  const input = {
    policy,
    previousApproved,
    approved,
    containsPrevious: true,
    changedPaths: ["scripts/approved-release.json"],
  };
  const missing = evaluateRecordAdvance({ ...input, record: null });
  assert.ok(missing.failures.includes("production deployment could not be verified"));
  for (const readyState of ["BUILDING", "ERROR"]) {
    const unfinished = evaluateRecordAdvance({ ...input, record: { ...ready, readyState } });
    assert.ok(unfinished.failures.includes("production deployment is not READY"), readyState);
  }
  const wrongDomain = evaluateRecordAdvance({
    ...input,
    record: { ...ready, aliases: ["preview.example"] },
  });
  assert.ok(wrongDomain.failures.some((failure) => failure.includes(policy.productionHost)));
  const unrelated = evaluateRecordAdvance({ ...input, record: ready, containsPrevious: false });
  assert.ok(unrelated.failures.includes("new production commit does not contain the previous production commit"));
  const differentProduction = evaluateRecordAdvance({
    ...input,
    record: { ...ready, deploymentId: "dpl_otherdeploy", sha: previousSha },
  });
  assert.ok(differentProduction.failures.includes("production deployment SHA does not match the approved release record"));
  assert.ok(differentProduction.failures.includes("production deployment id does not match the approved release record"));
});

test("a record update cannot include another file or skip the previous commit", () => {
  const approved = {
    repository: policy.repository,
    branch: policy.productionBranch,
    sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    deploymentId: "dpl_newdeploy",
  };
  const record = {
    deploymentId: approved.deploymentId,
    sha: approved.sha,
    readyState: "READY",
    target: "production",
    aliases: [policy.productionHost],
  };
  const previousApproved = {
    repository: policy.repository,
    branch: policy.productionBranch,
    sha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    deploymentId: "dpl_olddeploy",
  };
  const extraFile = evaluateRecordAdvance({
    policy,
    previousApproved,
    approved,
    record,
    containsPrevious: true,
    changedPaths: ["scripts/approved-release.json", "lib/payments/transfers.ts"],
  });
  assert.ok(extraFile.failures.includes("production record update changes more than the approved release record"));
  const skipped = evaluateRecordAdvance({
    policy,
    previousApproved,
    approved,
    record,
    containsPrevious: false,
    changedPaths: ["scripts/approved-release.json"],
  });
  assert.ok(skipped.failures.includes("new production commit does not contain the previous production commit"));
});

test("GitHub verification failure blocks the release", () => {
  const result = evaluateRelease(
    releaseOf(readCommit(root, "HEAD").sha, { githubFailures: ["GitHub branch could not be verified"] }),
  );
  assert.equal(result.ok, false);
  assert.ok(result.failures.includes("GitHub branch could not be verified"));
});

test("the current production commit passes source and ancestry checks", { timeout: 90_000 }, async () => {
  const approved = loadApprovedRelease();
  const record = loadProductionRecord(policy);
  assert.ok(record, "production deployment could not be verified");
  assert.equal(approved.sha, "58779556a9205a2982ffc7df00a56b223a420491");
  assert.equal(approved.deploymentId, "dpl_Bd341qB4V2QPg99QMWJsJParw2h5");
  assert.equal(record.sha, approved.sha);
  assert.equal(record.deploymentId, approved.deploymentId);
  const commit = readCommit(root, record.sha);
  assert.ok(commit, "production commit is not available locally");
  const head = readCommit(root, "HEAD");
  const githubFailures = verifyGithubBranch(root, policy.productionBranch, approved.sha, head.sha);
  const release = {
    record,
    approved,
    githubFailures,
    ancestor: commitContains(root, approved.sha, head.sha),
    baselineMigrations: commit.migrations,
    releaseMigrations: head.migrations,
    files: head.files,
  };
  const landingLoadApplied = await readLandingLoadApplied(loadDotEnv(root));
  const future = evaluateRelease(releaseOf(head.sha, { ...release, previousApproved: approved, landingLoadApplied }));
  assert.deepEqual(future.failures, []);
  assert.equal(future.ok, true);
  const previousApproved = approvedReleaseAt(root, "HEAD^");
  const current = evaluateRelease(releaseOf(head.sha, { ...release, previousApproved, landingLoadApplied }));
  const recordMoved =
    previousApproved != null &&
    (previousApproved.sha !== approved.sha ||
      previousApproved.deploymentId !== approved.deploymentId ||
      previousApproved.branch !== approved.branch ||
      previousApproved.repository !== approved.repository);
  if (recordMoved) {
    assert.equal(current.ok, false);
    assert.ok(current.failures.includes("approved production baseline changed"));
  } else {
    assert.deepEqual(current.failures, []);
    assert.equal(current.ok, true);
  }
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

test("the guard command refuses a dirty fixture without deploying", { timeout: 90_000 }, () => {
  const dir = mkdtempSync(join(tmpdir(), "pickuply-release-guard-"));
  let thrown = null;
  try {
    execFileSync("git", ["init"], { cwd: dir, stdio: "ignore" });
    writeFileSync(join(dir, "README"), "fixture\n");
    execFileSync("git", ["add", "README"], { cwd: dir, stdio: "ignore" });
    execFileSync(
      "git",
      ["-c", "user.email=guard@example.com", "-c", "user.name=Release Guard", "commit", "-m", "fixture"],
      { cwd: dir, stdio: "ignore" },
    );
    writeFileSync(join(dir, "README"), "fixture\nuncommitted\n");
    try {
      execFileSync(process.execPath, [fileURLToPath(new URL("./release-guard.mjs", import.meta.url))], {
        cwd: dir,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      thrown = error;
    }
  } finally {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {
      // A locked temporary directory must not hide the guard result.
    }
  }
  assert.ok(thrown, "the dirty fixture was accepted");
  assert.equal(thrown.status, 1);
  const output = `${thrown.stdout ?? ""}\n${thrown.stderr ?? ""}`;
  if (!output.includes("uncommitted changes")) throw new Error("dirty tree was not the refusal reason");
  if (output.includes("vercel deploy")) throw new Error("the guard tried to deploy");
});

test("the record command refuses a dirty tree and cannot deploy", () => {
  let combined = null;
  try {
    execFileSync(process.execPath, [fileURLToPath(new URL("./release-guard.mjs", import.meta.url)), "--record", "--full"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    throw new Error("record check with --full was accepted");
  } catch (error) {
    combined = `${error.stdout ?? ""}\n${error.stderr ?? ""}`;
    assert.equal(error.status, 1);
  }
  assert.match(combined, /does not deploy/);
  if (combined.includes("vercel deploy")) throw new Error("the record check tried to deploy");

  const dir = mkdtempSync(join(tmpdir(), "pickuply-record-guard-"));
  let thrown = null;
  try {
    execFileSync("git", ["init"], { cwd: dir, stdio: "ignore" });
    writeFileSync(join(dir, "README"), "fixture\n");
    execFileSync("git", ["add", "README"], { cwd: dir, stdio: "ignore" });
    execFileSync(
      "git",
      ["-c", "user.email=guard@example.com", "-c", "user.name=Release Guard", "commit", "-m", "fixture"],
      { cwd: dir, stdio: "ignore" },
    );
    writeFileSync(join(dir, "README"), "fixture\nuncommitted\n");
    try {
      execFileSync(process.execPath, [fileURLToPath(new URL("./release-guard.mjs", import.meta.url)), "--record"], {
        cwd: dir,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      thrown = error;
    }
  } finally {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {
      // A locked temporary directory must not hide the guard result.
    }
  }
  assert.ok(thrown, "the dirty record update was accepted");
  assert.equal(thrown.status, 1);
  const output = `${thrown.stdout ?? ""}\n${thrown.stderr ?? ""}`;
  assert.match(output, /uncommitted changes/);
  assert.doesNotMatch(output, /production record ok/);
  assert.doesNotMatch(output, /vercel deploy/);
});
