import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildDeploymentReport } from "./release-deploy-report.mjs";
import { compareMigrations } from "./release-guard.mjs";
import {
  acquireReleaseLock,
  defaultReleaseLockPath,
  evaluateManualRelease,
  manualReleaseOutcome,
  releaseLockMessage,
  releaseReleaseLock,
} from "./release-manual.mjs";

const policy = {
  repository: "joshtutu777/pickuply",
  productionBranch: "main",
  productionHost: "pickuplyapp.com",
  vercelScope: "pickuply-app",
  vercelProjectId: "prj_EPGuyrSlw9XsFlDyeuWEZcM3Ymw0",
};
const head = "a".repeat(40);
const productionSha = "b".repeat(40);
const approved = {
  repository: policy.repository,
  branch: "main",
  sha: productionSha,
  deploymentId: "dpl_olddeploy",
};
const live = {
  deploymentId: approved.deploymentId,
  sha: approved.sha,
  readyState: "READY",
  target: "production",
  aliases: [policy.productionHost],
};

function ready(patch = {}) {
  return {
    policy,
    status: "",
    branch: "main",
    head,
    mainTip: head,
    mainTipBeforeDeploy: head,
    live,
    approved,
    deployments: [{ deploymentId: approved.deploymentId, sha: approved.sha, readyState: "READY", target: "production" }],
    migrationFailures: [],
    migrationsApproved: false,
    checksPassed: true,
    confirmSha: head,
    confirmDeployment: approved.deploymentId,
    ...patch,
  };
}

test("a dirty checkout, wrong branch, or stale commit is refused", () => {
  const dirty = evaluateManualRelease(ready({ status: " M app/driver/page.tsx" }));
  assert.ok(dirty.failures.includes("working tree has uncommitted changes"));
  const wrongBranch = evaluateManualRelease(ready({ branch: "release/mobile-ux" }));
  assert.ok(wrongBranch.failures.includes("branch is release/mobile-ux, production branch is main"));
  const stale = evaluateManualRelease(ready({ mainTip: productionSha }));
  assert.ok(stale.failures.includes("checkout is not the current main tip"));
  const moved = evaluateManualRelease(ready({ mainTipBeforeDeploy: productionSha }));
  assert.ok(moved.failures.includes("origin/main changed before deployment"));
  for (const result of [dirty, wrongBranch, stale, moved]) assert.equal(result.ok, false);
});

test("a production baseline mismatch or migration change is refused", () => {
  const mismatch = evaluateManualRelease(
    ready({ live: { ...live, deploymentId: "dpl_otherdeploy", sha: "c".repeat(40) } }),
  );
  assert.ok(mismatch.failures.includes("live production does not match the approved release record"));
  const migrations = compareMigrations(
    [{ path: "supabase/migrations/0001.sql", oid: "aaa" }],
    [
      { path: "supabase/migrations/0001.sql", oid: "aaa" },
      { path: "supabase/migrations/0002.sql", oid: "bbb" },
    ],
  );
  const changed = evaluateManualRelease(ready({ migrationFailures: migrations }));
  assert.ok(changed.failures.some((failure) => failure.includes("new migration files block the release")));
  assert.equal(mismatch.ok, false);
  assert.equal(changed.ok, false);
});

test("failed tests or missing confirmation refuse the deploy", () => {
  const failed = evaluateManualRelease(ready({ checksPassed: false }));
  assert.ok(failed.failures.includes("tests, typecheck, or production build failed"));
  const missing = evaluateManualRelease(ready({ confirmSha: undefined, confirmDeployment: undefined }));
  assert.ok(missing.failures.includes("owner confirmation is missing"));
  assert.ok(missing.failures.includes("owner confirmation is missing the production deployment"));
  const wrong = evaluateManualRelease(ready({ confirmSha: productionSha, confirmDeployment: "dpl_otherdeploy" }));
  assert.ok(wrong.failures.includes("owner confirmation does not match the commit"));
  assert.ok(wrong.failures.includes("owner confirmation does not match the production deployment"));
  assert.equal(evaluateManualRelease(ready()).ok, true);
});

test("a failed or uncertain deployment is reported and does not update the record", () => {
  const failed = manualReleaseOutcome(
    buildDeploymentReport({
      host: policy.productionHost,
      expectedSha: head,
      deployExitCode: 1,
      inspectExitCode: 1,
      deployStdout: "",
      deployStderr: "Error for dpl_newdeploy\n",
      inspected: null,
      live,
      approved,
    }),
    policy,
    head,
  );
  assert.equal(failed.ok, false);
  assert.equal(failed.record, null);
  assert.ok(failed.lines.includes("created deployment dpl_newdeploy"));
  assert.ok(failed.lines.includes("deploy command exited 1; it was not retried"));
  assert.ok(failed.lines.includes("current production still matches the approved record"));

  const uncertain = manualReleaseOutcome(
    buildDeploymentReport({
      host: policy.productionHost,
      expectedSha: head,
      deployExitCode: 0,
      inspectExitCode: 0,
      deployStdout: "https://pickuply-reviewed.vercel.app\n",
      deployStderr: "",
      inspected: {
        id: "dpl_newdeploy",
        readyState: "BUILDING",
        target: "production",
        alias: [policy.productionHost],
        meta: { gitCommitSha: head },
      },
      live,
      approved,
    }),
    policy,
    head,
  );
  assert.equal(uncertain.ok, false);
  assert.equal(uncertain.record, null);
  assert.ok(uncertain.lines.includes("deployment is BUILDING"));
  assert.ok(uncertain.lines.includes("inspected deployment dpl_newdeploy"));
  assert.ok(uncertain.lines.includes("this job did not roll back, redeploy, or edit the approved release record"));
});

test("successful verification prints the next record and does not deploy again", () => {
  const outcome = manualReleaseOutcome(
    buildDeploymentReport({
      host: policy.productionHost,
      expectedSha: head,
      deployExitCode: 0,
      inspectExitCode: 0,
      deployStdout: "https://pickuply-reviewed.vercel.app\n",
      deployStderr: "",
      inspected: {
        id: "dpl_newdeploy",
        readyState: "READY",
        target: "production",
        alias: [policy.productionHost],
        meta: { gitCommitSha: head },
      },
      live: {
        deploymentId: "dpl_newdeploy",
        sha: head,
        readyState: "READY",
        target: "production",
        aliases: [policy.productionHost],
      },
      approved,
    }),
    policy,
    head,
  );
  assert.equal(outcome.ok, true);
  assert.deepEqual(outcome.record, {
    repository: policy.repository,
    branch: "main",
    sha: head,
    deploymentId: "dpl_newdeploy",
  });
  const source = readFileSync(new URL("./release-manual.mjs", import.meta.url), "utf8");
  assert.equal(source.match(/"deploy",/g).length, 1);
  assert.doesNotMatch(source, /vercel rollback|vercel promote|--verify|--env |approved-release\.json", /);
});

test("an existing release lock is kept and a second run cannot replace it", () => {
  assert.equal(basename(defaultReleaseLockPath), "production-release.lock");
  assert.equal(basename(dirname(defaultReleaseLockPath)), ".pickuply");
  const dir = mkdtempSync(join(tmpdir(), "pickuply-manual-lock-"));
  const lockPath = join(dir, "production-release.lock");
  try {
    const first = acquireReleaseLock(lockPath, {
      pid: 111,
      startedAt: "2026-11-18T00:00:00.000Z",
      cwd: dir,
      sha: head,
    });
    assert.equal(first.ok, true);
    const second = acquireReleaseLock(lockPath, {
      pid: 222,
      startedAt: "2026-11-18T01:00:00.000Z",
      cwd: dir,
      sha: productionSha,
    });
    assert.equal(second.ok, false);
    assert.equal(second.lock.pid, 111);
    assert.equal(second.lock.sha, head);
    const message = releaseLockMessage(second).join("\n");
    assert.match(message, /already held on this computer/);
    assert.match(message, /other machines are outside this lock/);
    assert.match(message, /Delete the lock file/);
    assert.match(message, /uncertain deployment must be investigated before another release/);
    assert.equal(releaseReleaseLock(lockPath), true);
    const third = acquireReleaseLock(lockPath, {
      pid: 333,
      startedAt: "2026-11-18T02:00:00.000Z",
      cwd: dir,
      sha: head,
    });
    assert.equal(third.ok, true);
    assert.equal(releaseReleaseLock(lockPath), true);
  } finally {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {
      // A locked temporary directory must not hide the assertion.
    }
  }

  const source = readFileSync(new URL("./release-manual.mjs", import.meta.url), "utf8");
  const mainStart = source.indexOf("function main()");
  const hold = source.indexOf("holdReleaseLock(", mainStart);
  const fetch = source.indexOf("fetchMainTip(", mainStart);
  const input = source.indexOf("releaseInput(", mainStart);
  assert.ok(hold > mainStart && hold < fetch && hold < input);
  const finishStart = source.indexOf("function finish(");
  const stopped = source.indexOf("releaseOnExit = false", finishStart);
  const call = source.indexOf("deployOnce(", finishStart);
  const deployArg = source.indexOf('"deploy",', finishStart);
  assert.ok(stopped > finishStart && stopped < call && call < deployArg);
});

test("the command refuses a dirty or wrong-branch checkout without deploying", () => {
  const script = fileURLToPath(new URL("./release-manual.mjs", import.meta.url));
  const dirty = mkdtempSync(join(tmpdir(), "pickuply-manual-dirty-"));
  const wrong = mkdtempSync(join(tmpdir(), "pickuply-manual-branch-"));
  try {
    execFileSync("git", ["init", "-b", "main"], { cwd: dirty, stdio: "ignore" });
    writeFileSync(join(dirty, "README"), "fixture\n");
    execFileSync("git", ["add", "README"], { cwd: dirty, stdio: "ignore" });
    execFileSync("git", ["-c", "user.email=guard@example.com", "-c", "user.name=Release Guard", "commit", "-m", "fixture"], {
      cwd: dirty,
      stdio: "ignore",
    });
    writeFileSync(join(dirty, "README"), "fixture\nuncommitted\n");
    let dirtyError = null;
    try {
      execFileSync(process.execPath, [script], { cwd: dirty, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      dirtyError = error;
    }
    assert.equal(dirtyError?.status, 1);
    const dirtyOutput = `${dirtyError.stdout ?? ""}\n${dirtyError.stderr ?? ""}`;
    assert.match(dirtyOutput, /uncommitted changes/);
    assert.doesNotMatch(dirtyOutput, /vc\.js|verified deployment/);

    execFileSync("git", ["init", "-b", "main"], { cwd: wrong, stdio: "ignore" });
    writeFileSync(join(wrong, "README"), "fixture\n");
    execFileSync("git", ["add", "README"], { cwd: wrong, stdio: "ignore" });
    execFileSync("git", ["-c", "user.email=guard@example.com", "-c", "user.name=Release Guard", "commit", "-m", "fixture"], {
      cwd: wrong,
      stdio: "ignore",
    });
    execFileSync("git", ["checkout", "-b", "topic"], { cwd: wrong, stdio: "ignore" });
    let branchError = null;
    try {
      execFileSync(process.execPath, [script], { cwd: wrong, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      branchError = error;
    }
    assert.equal(branchError?.status, 1);
    const branchOutput = `${branchError.stdout ?? ""}\n${branchError.stderr ?? ""}`;
    assert.match(branchOutput, /branch is topic, production branch is main/);
    assert.doesNotMatch(branchOutput, /verified deployment/);
  } finally {
    for (const dir of [dirty, wrong]) {
      try {
        rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      } catch {
        // A locked temporary directory must not hide the refusal.
      }
    }
  }
});
