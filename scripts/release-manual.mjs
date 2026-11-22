import { spawnSync } from "node:child_process";
import { closeSync, mkdirSync, openSync, readFileSync, unlinkSync, writeSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildDeploymentReport,
  deploymentTarget,
  nextApprovedRecord,
} from "./release-deploy-report.mjs";
import {
  approvedReleaseAt,
  checkBranch,
  checkClean,
  compareMigrations,
  databaseChangesAllowed,
  loadDotEnv,
  readLandingLoadApplied,
  git,
  loadApprovedRelease,
  loadProductionDeployments,
  loadProductionRecord,
  loadReleasePolicy,
  readCommit,
  vercelBin,
} from "./release-guard.mjs";

const shaPattern = /^[0-9a-f]{40}$/;
export const defaultReleaseLockPath = join(homedir(), ".pickuply", "production-release.lock");
let releaseOnExit = false;

export function readReleaseLock(lockPath) {
  try {
    const text = readFileSync(lockPath, "utf8").trim();
    if (!text) return null;
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

export function acquireReleaseLock(lockPath, info) {
  mkdirSync(dirname(lockPath), { recursive: true });
  let fd;
  try {
    fd = openSync(lockPath, "wx");
  } catch (error) {
    if (error?.code === "EEXIST") return { ok: false, path: lockPath, lock: readReleaseLock(lockPath) };
    throw error;
  }
  try {
    writeSync(
      fd,
      `${JSON.stringify(
        {
          pid: info.pid,
          startedAt: info.startedAt,
          cwd: info.cwd,
          sha: info.sha,
        },
        null,
        2,
      )}\n`,
    );
  } catch (error) {
    closeSync(fd);
    try {
      unlinkSync(lockPath);
    } catch {
      // A partial lock must stay in place when it cannot be removed.
    }
    throw error;
  }
  closeSync(fd);
  return { ok: true, path: lockPath, lock: info };
}

export function releaseReleaseLock(lockPath) {
  try {
    unlinkSync(lockPath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

export function releaseLockMessage(held) {
  const details = held.lock ?? {};
  const lines = [
    "a production release lock is already held on this computer",
    `Lock file: ${held.path}`,
  ];
  if (details.pid) lines.push(`Process id: ${details.pid}`);
  if (details.startedAt) lines.push(`Started: ${details.startedAt}`);
  if (details.cwd) lines.push(`Directory: ${details.cwd}`);
  if (details.sha) lines.push(`Commit: ${details.sha}`);
  lines.push(
    "This lock covers only this user on this computer. Releases from other machines are outside this lock.",
    "If that process is still running, wait for it to finish.",
    "If that process is gone, the lock is stale. Recover it in this order:",
    "1. Confirm no node scripts/release-manual.mjs process is running.",
    "2. Inspect the Vercel deployment serving pickuplyapp.com and the newest production deployments.",
    "3. If a deployment was created or is still building, investigate it before another release. An uncertain deployment must be investigated before another release.",
    "4. Delete the lock file shown above.",
    "5. Start the release command again only after that inspection.",
  );
  return lines;
}

export function manualSourceFailures(input) {
  const failures = [
    ...checkClean(input.status),
    ...checkBranch(input.branch, input.policy),
  ];
  const head = input.head ?? "";
  if (!shaPattern.test(head)) failures.push("release commit is not a full commit id");
  if (input.mainTip !== head) failures.push("checkout is not the current main tip");
  if (input.mainTipBeforeDeploy !== head) failures.push("origin/main changed before deployment");
  const live = input.live;
  const approved = input.approved;
  if (!live) failures.push("production deployment could not be verified");
  else {
    if (live.readyState !== "READY") failures.push("production deployment is not READY");
    if (!(live.aliases ?? []).includes(input.policy.productionHost)) {
      failures.push(`deployment is not serving ${input.policy.productionHost}`);
    }
    if (live.sha === head) failures.push("requested commit is already serving production");
  }
  if (
    !approved ||
    approved.repository !== input.policy.repository ||
    approved.branch !== input.policy.productionBranch ||
    !live ||
    live.sha !== approved.sha ||
    live.deploymentId !== approved.deploymentId
  ) {
    failures.push("live production does not match the approved release record");
  }
  if (!Array.isArray(input.deployments)) failures.push("production deployment list could not be verified");
  else {
    const unfinished = input.deployments.some((item) => {
      const state = item?.readyState ?? "";
      return state !== "READY" && state !== "ERROR" && state !== "CANCELED";
    });
    const sameCommit = input.deployments.some((item) => item?.sha && item.sha === head);
    if (unfinished) failures.push("a production deployment is still in progress");
    if (sameCommit) failures.push("a deployment for the requested commit already exists");
  }
  if (!Array.isArray(input.migrationFailures)) failures.push("production migration history could not be read");
  else failures.push(...input.migrationFailures);
  if (input.migrationsApproved === true || databaseChangesAllowed()) {
    failures.push("RELEASE_MIGRATIONS does not authorize production database changes");
  }
  return failures;
}

export function manualCheckFailures(checksPassed) {
  return checksPassed === true ? [] : ["tests, typecheck, or production build failed"];
}

export function manualConfirmationFailures(input) {
  const failures = [];
  if (!input.confirmSha) failures.push("owner confirmation is missing");
  else if (input.confirmSha !== input.head) failures.push("owner confirmation does not match the commit");
  if (!input.confirmDeployment) failures.push("owner confirmation is missing the production deployment");
  else if (input.confirmDeployment !== input.live?.deploymentId) {
    failures.push("owner confirmation does not match the production deployment");
  }
  return failures;
}

export function evaluateManualRelease(input) {
  const failures = [
    ...manualSourceFailures(input),
    ...manualCheckFailures(input.checksPassed),
    ...manualConfirmationFailures(input),
  ];
  return { ok: failures.length === 0, failures };
}

export function manualReleaseOutcome(report, policy, sha) {
  const lines = [...(report.lines ?? [])];
  const created = report.createdIds ?? [];
  if (created.length === 1 && created[0] !== report.deploymentId) {
    lines.push("created deployment does not match the verified production deployment");
  }
  const createdMatches = created.length !== 1 || created[0] === report.deploymentId;
  const record = report.ok && createdMatches ? nextApprovedRecord(policy, sha, report.deploymentId) : null;
  if (report.ok && !record) lines.push("verified deployment could not be recorded");
  return { ok: Boolean(record), record, lines };
}

function option(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) return "";
  return value;
}

function refuse(failures, identity) {
  for (const failure of failures) console.error(`release refused: ${failure}`);
  if (identity) console.error(identity);
  console.error("This command did not deploy, roll back, or edit the approved release record.");
  process.exit(1);
}

function fetchMainTip(cwd) {
  git(cwd, ["fetch", "--no-tags", "origin", "refs/heads/main:refs/remotes/origin/main"]);
  return git(cwd, ["rev-parse", "origin/main"]).trim();
}

function migrationFailures(cwd, approved, landingLoadApplied) {
  if (!approved?.sha) return ["production migration history could not be read"];
  const baseline = readCommit(cwd, approved.sha);
  const head = readCommit(cwd, "HEAD");
  if (!baseline || !head) return ["production migration history could not be read"];
  return compareMigrations(baseline.migrations, head.migrations, { landingLoadApplied });
}

function releaseInput(cwd, policy, mainTip, mainTipBeforeDeploy, landingLoadApplied) {
  const head = git(cwd, ["rev-parse", "HEAD"]).trim();
  const branch = git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]).trim();
  const status = git(cwd, ["status", "--porcelain"]);
  const approved = loadApprovedRelease();
  const atHead = approvedReleaseAt(cwd, "HEAD");
  const live = loadProductionRecord(policy);
  const deployments = loadProductionDeployments(policy);
  return {
    policy,
    status,
    branch,
    head,
    mainTip,
    mainTipBeforeDeploy,
    live,
    approved: atHead ?? approved,
    deployments,
    migrationFailures: migrationFailures(cwd, atHead ?? approved, landingLoadApplied),
    migrationsApproved: process.env.RELEASE_MIGRATIONS === "approved",
    checksPassed: true,
    confirmSha: option("--confirm-sha"),
    confirmDeployment: option("--confirm-deployment"),
  };
}

function identityLine(input) {
  const deployment = input.live?.deploymentId ? `${input.live.deploymentId} (${input.live.sha})` : "unverified";
  return `Commit ${input.head}\nProduction deployment ${deployment}`;
}

function runGuard(cwd) {
  return spawnSync(process.execPath, [fileURLToPath(new URL("./release-guard.mjs", import.meta.url)), "--full"], {
    cwd,
    stdio: "inherit",
    windowsHide: true,
    env: process.env,
  });
}

function runPinned(cwd, args) {
  return spawnSync(process.execPath, [vercelBin(), ...args], {
    cwd,
    encoding: "utf8",
    windowsHide: true,
    env: process.env,
  });
}

function finish(cwd, policy, sha) {
  releaseOnExit = false;
  let outcome = null;
  try {
    outcome = deployOnce(cwd, policy, sha);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "release verification failed");
    console.error("The release lock was kept because deployment verification did not finish.");
    for (const line of releaseLockMessage({
      path: defaultReleaseLockPath,
      lock: readReleaseLock(defaultReleaseLockPath),
    }).slice(1)) {
      console.error(line);
    }
    console.error("This command did not retry, roll back, or edit the approved release record.");
    process.exit(1);
  }
  releaseOnExit = true;
  if (!outcome.ok) {
    console.error("An uncertain deployment must be investigated before another release.");
    console.error("This command did not retry, roll back, or edit the approved release record.");
    process.exit(1);
  }
  console.log(JSON.stringify(outcome.record, null, 2));
  console.log(
    "Do not deploy this follow-up. Commit only scripts/approved-release.json with the JSON above, then run node scripts/release-guard.mjs --record.",
  );
}

function deployOnce(cwd, policy, sha) {
  const deploy = runPinned(cwd, [
    "deploy",
    ".",
    "--prod",
    "--yes",
    "--scope",
    policy.vercelScope,
    "--project",
    policy.vercelProjectId,
    "--meta",
    `gitCommitSha=${sha}`,
    "--meta",
    "gitCommitRef=main",
  ]);
  const deployText = `${deploy.stdout ?? ""}\n${deploy.stderr ?? ""}`;
  const target = deploymentTarget(deployText);
  const inspect =
    target && /^(?:https:\/\/[A-Za-z0-9.-]+\.vercel\.app|dpl_[A-Za-z0-9]+)$/.test(target)
      ? runPinned(cwd, ["inspect", target, "--scope", policy.vercelScope, "--json"])
      : { status: 1, stdout: "", stderr: "" };
  let inspected = null;
  if (inspect.status === 0 && inspect.stdout) {
    try {
      const text = inspect.stdout.replace(/^\uFEFF/, "");
      const start = text.search(/[\[{]/);
      inspected = start < 0 ? null : JSON.parse(text.slice(start));
    } catch {
      inspected = null;
    }
  }
  const report = buildDeploymentReport({
    host: policy.productionHost,
    expectedSha: sha,
    deployExitCode: deploy.status === 0 ? 0 : deploy.status ?? 1,
    inspectExitCode: inspect.status === 0 ? 0 : inspect.status ?? 1,
    deployStdout: deploy.stdout ?? "",
    deployStderr: deploy.stderr ?? "",
    inspected,
    live: loadProductionRecord(policy),
    approved: loadApprovedRelease(),
  });
  const outcome = manualReleaseOutcome(report, policy, sha);
  for (const line of outcome.lines) console.error(line);
  return outcome;
}

function holdReleaseLock(cwd, sha) {
  const held = acquireReleaseLock(defaultReleaseLockPath, {
    pid: process.pid,
    startedAt: new Date().toISOString(),
    cwd,
    sha,
  });
  if (!held.ok) {
    const lines = releaseLockMessage(held);
    refuse([lines[0]], lines.slice(1).join("\n"));
  }
  releaseOnExit = true;
  process.once("exit", () => {
    if (releaseOnExit) releaseReleaseLock(defaultReleaseLockPath);
  });
}

function localCheckout(cwd) {
  return {
    status: git(cwd, ["status", "--porcelain"]),
    branch: git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]).trim(),
    head: git(cwd, ["rev-parse", "HEAD"]).trim(),
  };
}

async function main() {
  const unknown = process.argv.slice(2).filter((arg, index, args) => {
    if (!arg.startsWith("--")) return false;
    if (arg !== "--confirm-sha" && arg !== "--confirm-deployment") return true;
    return args.indexOf(arg) !== index;
  });
  if (unknown.length > 0) refuse(["unknown release option"]);
  const cwd = process.cwd();
  const policy = loadReleasePolicy();
  const checkout = localCheckout(cwd);
  const checkoutFailures = [
    ...checkClean(checkout.status),
    ...checkBranch(checkout.branch, policy),
    ...(shaPattern.test(checkout.head) ? [] : ["release commit is not a full commit id"]),
  ];
  if (checkoutFailures.length > 0) refuse(checkoutFailures);
  holdReleaseLock(cwd, checkout.head);
  let mainTip;
  try {
    mainTip = fetchMainTip(cwd);
  } catch {
    refuse(["origin/main could not be verified"]);
  }
  const landingLoadApplied = await readLandingLoadApplied(loadDotEnv(cwd));
  let input = releaseInput(cwd, policy, mainTip, mainTip, landingLoadApplied);
  const early = manualSourceFailures(input);
  if (early.length > 0) refuse(early, identityLine(input));
  const guard = runGuard(cwd);
  if (guard.status !== 0) refuse(manualCheckFailures(false), identityLine(input));
  let tipBeforeDeploy;
  try {
    tipBeforeDeploy = fetchMainTip(cwd);
  } catch {
    refuse(["origin/main could not be verified"], identityLine(input));
  }
  input = releaseInput(cwd, policy, mainTip, tipBeforeDeploy, landingLoadApplied);
  const decision = evaluateManualRelease({ ...input, checksPassed: true });
  if (!decision.ok) refuse(decision.failures, identityLine(input));
  finish(cwd, policy, input.head);
}

const entry = process.argv[1]?.replaceAll("\\", "/");
if (entry?.endsWith("/scripts/release-manual.mjs")) {
  main().catch(() => {
    console.error("release refused: release preparation failed");
    process.exit(1);
  });
}
