import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const shaPattern = /^[0-9a-f]{40}$/;
const deploymentPattern = /^dpl_[A-Za-z0-9]+$/;
const projectPattern = /^prj_[A-Za-z0-9]+$/;
const scopePattern = /^[a-z0-9-]+$/;

export function loadReleasePolicy() {
  return JSON.parse(readFileSync(join(here, "release-policy.json"), "utf8"));
}

export function databaseChangesAllowed() {
  return false;
}

export function repositoryName(remoteUrl) {
  const match = String(remoteUrl ?? "").match(/github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/);
  return match ? `${match[1]}/${match[2]}` : null;
}

export function checkRepository(remoteUrl, policy) {
  const name = repositoryName(remoteUrl);
  if (name !== policy.repository) return [`repository is ${name ?? "unknown"}, expected ${policy.repository}`];
  return [];
}

export function checkBranch(branch, policy) {
  if (branch !== policy.productionBranch) {
    return [`branch is ${branch || "detached"}, production branch is ${policy.productionBranch}`];
  }
  return [];
}

export function checkClean(porcelain) {
  if (String(porcelain ?? "").trim()) return ["working tree has uncommitted changes"];
  return [];
}

export function readApprovedRelease(text) {
  try {
    const value = JSON.parse(text);
    const approved = {
      repository: value.repository,
      branch: value.branch,
      sha: value.sha,
      deploymentId: value.deploymentId,
    };
    if (!shaPattern.test(approved.sha ?? "")) return null;
    if (!deploymentPattern.test(approved.deploymentId ?? "")) return null;
    if (typeof approved.repository !== "string" || typeof approved.branch !== "string") return null;
    return approved;
  } catch {
    return null;
  }
}

export function loadApprovedRelease() {
  try {
    return readApprovedRelease(readFileSync(join(here, "approved-release.json"), "utf8"));
  } catch {
    return null;
  }
}

export function checkProductionRecord(record, policy) {
  if (!record) return ["production deployment could not be verified"];
  const failures = [];
  if (!shaPattern.test(record.sha ?? "")) failures.push("production deployment has no commit SHA");
  if (record.readyState !== "READY") failures.push("production deployment is not READY");
  if (record.target !== "production") failures.push("deployment is not a production target");
  if (!(record.aliases ?? []).includes(policy.productionHost)) {
    failures.push(`deployment is not serving ${policy.productionHost}`);
  }
  if (!deploymentPattern.test(record.deploymentId ?? "")) failures.push("production deployment id is missing");
  return failures;
}

export function checkApprovedAgreement(approved, record, policy) {
  if (!approved) return ["approved production release record is missing"];
  const failures = [];
  if (approved.repository !== policy.repository || approved.branch !== policy.productionBranch) {
    failures.push("approved production release record does not match this repository");
  }
  if (!record || !shaPattern.test(record.sha ?? "") || !deploymentPattern.test(record.deploymentId ?? "")) {
    return failures;
  }
  if (record.sha !== approved.sha) {
    failures.push("production deployment SHA does not match the approved release record");
  }
  if (record.deploymentId !== approved.deploymentId) {
    failures.push("production deployment id does not match the approved release record");
  }
  return failures;
}

export function evaluateRecordAdvance(input) {
  const failures = [
    ...checkProductionRecord(input.record, input.policy),
    ...checkApprovedAgreement(input.approved, input.record, input.policy),
  ];
  const previous = input.previousApproved;
  const approved = input.approved;
  if (!previous) failures.push("previous approved production record is missing");
  if (previous && approved) {
    if (previous.repository !== approved.repository) failures.push("approved production repository changed");
    const unchanged =
      previous.sha === approved.sha &&
      previous.deploymentId === approved.deploymentId &&
      previous.branch === approved.branch;
    if (unchanged) failures.push("approved production record did not advance");
    if (previous.sha !== approved.sha && input.containsPrevious !== true) {
      failures.push("new production commit does not contain the previous production commit");
    }
  }
  const paths = (input.changedPaths ?? []).map((path) => String(path).replaceAll("\\", "/")).sort();
  if (paths.length !== 1 || paths[0] !== "scripts/approved-release.json") {
    failures.push("production record update changes more than the approved release record");
  }
  return { ok: failures.length === 0, failures };
}

export function checkBaselineUnchanged(previousApproved, approved) {
  if (!previousApproved) return [];
  if (
    !approved ||
    previousApproved.sha !== approved.sha ||
    previousApproved.deploymentId !== approved.deploymentId ||
    previousApproved.repository !== approved.repository ||
    previousApproved.branch !== approved.branch
  ) {
    return ["approved production baseline changed"];
  }
  return [];
}

export function checkAncestry(containsBaseline) {
  if (containsBaseline === true) return [];
  if (containsBaseline === false) return ["release does not contain the current production commit"];
  return ["production ancestry could not be verified"];
}

export function compareMigrations(baseline, release) {
  const failures = [];
  const base = new Map(baseline.map((entry) => [entry.path, entry.oid]));
  const next = new Map(release.map((entry) => [entry.path, entry.oid]));
  for (const [path, oid] of base) {
    if (!next.has(path)) failures.push(`migration removed: ${path}`);
    else if (next.get(path) !== oid) failures.push(`migration rewritten: ${path}`);
  }
  const added = [...next.keys()].filter((path) => !base.has(path)).sort();
  if (added.length > 0) failures.push(`new migration files block the release: ${added.join(", ")}`);
  return failures;
}

export function missingRoutes(files, policy) {
  const present = new Set(files);
  return policy.requiredRoutes
    .filter((route) => !present.has(route.file))
    .map((route) => `missing route ${route.route} (${route.file})`);
}

export function evaluateRelease(input) {
  const policy = input.policy;
  const migrationFailures =
    input.baselineMigrations == null
      ? ["production migration history could not be read"]
      : compareMigrations(input.baselineMigrations, input.releaseMigrations ?? []);
  const failures = [
    ...checkRepository(input.remoteUrl, policy),
    ...checkBranch(input.branch, policy),
    ...checkClean(input.status),
    ...checkProductionRecord(input.record, policy),
    ...checkApprovedAgreement(input.approved, input.record, policy),
    ...checkBaselineUnchanged(input.previousApproved, input.approved),
    ...(input.githubFailures ?? ["GitHub branch could not be verified"]),
    ...checkAncestry(input.ancestor),
    ...migrationFailures,
    ...missingRoutes(input.files ?? [], policy),
  ];
  if (input.migrationsApproved === true || databaseChangesAllowed()) {
    failures.push("RELEASE_MIGRATIONS does not authorize production database changes");
  }
  return { ok: failures.length === 0, failures };
}

export function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

export function commitContains(cwd, ancestor, descendant) {
  if (!shaPattern.test(ancestor ?? "") || !shaPattern.test(descendant ?? "")) return null;
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", ancestor, descendant], {
      cwd,
      stdio: "ignore",
    });
    return true;
  } catch (error) {
    if (error.status === 1) return false;
    return null;
  }
}

export function verifyGithubBranch(cwd, branch, approvedSha, headSha) {
  if (!/^[A-Za-z0-9._/-]+$/.test(branch ?? "") || branch.includes("..")) {
    return ["GitHub branch could not be verified"];
  }
  if (!shaPattern.test(approvedSha ?? "") || !shaPattern.test(headSha ?? "")) {
    return ["GitHub branch could not be verified"];
  }
  let remoteTip = "";
  try {
    const output = git(cwd, ["ls-remote", "origin", `refs/heads/${branch}`]).trim();
    remoteTip = output.split(/\s+/)[0] ?? "";
  } catch {
    return ["GitHub branch could not be verified"];
  }
  if (!shaPattern.test(remoteTip)) return ["GitHub branch could not be verified"];
  if (commitContains(cwd, approvedSha, remoteTip) !== true) {
    return ["approved release is not on the GitHub branch"];
  }
  if (commitContains(cwd, remoteTip, headSha) !== true) {
    return ["GitHub branch has diverged from this release"];
  }
  return [];
}

function parseTree(text) {
  return text
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const tab = line.indexOf("\t");
      const oid = line.slice(0, tab).split(" ")[2];
      return { oid, path: line.slice(tab + 1).replaceAll("\\", "/") };
    });
}

export function readCommit(cwd, sha) {
  try {
    const resolved = git(cwd, ["rev-parse", "--verify", `${sha}^{commit}`]).trim();
    const files = git(cwd, ["ls-tree", "-r", "--name-only", resolved])
      .split(/\r?\n/)
      .filter(Boolean)
      .map((path) => path.replaceAll("\\", "/"));
    const migrations = parseTree(git(cwd, ["ls-tree", "-r", resolved, "supabase/migrations"]));
    return { sha: resolved, files, migrations };
  } catch {
    return null;
  }
}

export function approvedReleaseAt(cwd, sha) {
  if (!/^[A-Za-z0-9^~._/-]+$/.test(sha ?? "") || sha.includes("..")) return null;
  try {
    return readApprovedRelease(git(cwd, ["show", `${sha}:scripts/approved-release.json`]));
  } catch {
    return null;
  }
}

function decodeApi(buffer) {
  const text = (buffer.includes(0) ? buffer.toString("utf16le") : buffer.toString("utf8")).replace(/^\uFEFF/, "");
  const start = text.search(/[\[{]/);
  if (start < 0) throw new Error("production deployment response was not JSON");
  return text.slice(start);
}

function vercelApi(scope, path) {
  if (!scopePattern.test(scope)) throw new Error("unsafe scope");
  if (
    !/^\/v6\/deployments\?projectId=prj_[A-Za-z0-9]+&target=production&limit=8$/.test(path) &&
    !/^\/v13\/deployments\/dpl_[A-Za-z0-9]+$/.test(path)
  ) {
    throw new Error("unsafe path");
  }
  const cli = join(dirname(process.execPath), "node_modules", "npm", "bin", "npx-cli.js");
  const buffer = execFileSync(process.execPath, [cli, "--yes", "vercel", "api", path, "--scope", scope], {
    encoding: "buffer",
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(decodeApi(buffer));
}

export function productionRecordFromApi(list, details, policy) {
  const deployments = Array.isArray(list?.deployments) ? list.deployments : [];
  for (const item of deployments) {
    if (item.readyState !== "READY" || item.target !== "production") continue;
    const id = [item.uid, item.id].find((value) => deploymentPattern.test(value ?? ""));
    if (!id) continue;
    const detail = details.get(id);
    if (!detail) continue;
    const aliases = Array.isArray(detail.alias) ? detail.alias : [];
    const sha = detail.meta?.gitCommitSha ?? "";
    if (!aliases.includes(policy.productionHost) || !shaPattern.test(sha)) continue;
    if (!deploymentPattern.test(detail.id ?? "")) continue;
    return {
      deploymentId: detail.id,
      sha,
      readyState: detail.readyState,
      target: detail.target,
      aliases,
    };
  }
  return null;
}

export function loadProductionRecord(policy = loadReleasePolicy()) {
  if (!projectPattern.test(policy.vercelProjectId ?? "") || !scopePattern.test(policy.vercelScope ?? "")) return null;
  let list;
  try {
    list = vercelApi(policy.vercelScope, `/v6/deployments?projectId=${policy.vercelProjectId}&target=production&limit=8`);
  } catch {
    return null;
  }
  const details = new Map();
  for (const item of list.deployments ?? []) {
    if (item.readyState !== "READY" || item.target !== "production") continue;
    const id = [item.uid, item.id].find((value) => deploymentPattern.test(value ?? ""));
    if (!id) continue;
    try {
      details.set(id, vercelApi(policy.vercelScope, `/v13/deployments/${id}`));
    } catch {
      return null;
    }
    const record = productionRecordFromApi(list, details, policy);
    if (record) return record;
  }
  return null;
}

export function releaseSnapshot(cwd, sha, status = "") {
  const commit = readCommit(cwd, sha);
  if (!commit) return null;
  let remoteUrl = "";
  let branch = "";
  try {
    remoteUrl = git(cwd, ["remote", "get-url", "origin"]).trim();
    branch = git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]).trim();
  } catch {
    return null;
  }
  return { remoteUrl, branch, status, ...commit };
}

function runCaptured(command, args, cwd) {
  execFileSync(command, args, { cwd, stdio: "inherit", windowsHide: true });
}

export function runFullChecks(cwd, policy = loadReleasePolicy()) {
  const tests = policy.regressionTests ?? [];
  if (tests.some((file) => !/^[A-Za-z0-9._/-]+\.test\.tsx?$/.test(file))) {
    throw new Error("release refused: regression test path is not safe");
  }
  runCaptured(process.execPath, ["--import", "tsx", "--test", ...tests], cwd);
  runCaptured(process.execPath, [join(cwd, "node_modules/typescript/bin/tsc"), "--noEmit", "--pretty", "false"], cwd);
  runCaptured(process.execPath, [join(cwd, "node_modules/next/dist/bin/next"), "build"], cwd);
}

function recordAdvanceMain() {
  if (process.argv.includes("--full")) {
    console.error("release refused: the record check does not deploy");
    process.exit(1);
  }
  const cwd = process.cwd();
  const policy = loadReleasePolicy();
  const status = git(cwd, ["status", "--porcelain"]);
  const clean = checkClean(status);
  if (clean.length > 0) {
    for (const failure of clean) console.error(`release refused: ${failure}`);
    process.exit(1);
  }
  const head = git(cwd, ["rev-parse", "HEAD"]).trim();
  let parent = null;
  try {
    parent = git(cwd, ["rev-parse", `${head}^`]).trim();
  } catch {
    parent = null;
  }
  const approved = approvedReleaseAt(cwd, head);
  const previousApproved = parent ? approvedReleaseAt(cwd, parent) : null;
  const changedPaths = parent
    ? git(cwd, ["diff", "--name-only", parent, head])
        .split(/\r?\n/)
        .filter(Boolean)
    : [];
  const result = evaluateRecordAdvance({
    policy,
    previousApproved,
    approved,
    record: loadProductionRecord(policy),
    containsPrevious:
      previousApproved?.sha && approved?.sha ? commitContains(cwd, previousApproved.sha, approved.sha) : false,
    changedPaths,
  });
  if (!result.ok) {
    for (const failure of result.failures) console.error(`release refused: ${failure}`);
    process.exit(1);
  }
  console.log(`production record ok ${approved.sha} (${approved.deploymentId})`);
}

function productionJsonMain() {
  if (process.argv.includes("--full") || process.argv.includes("--record")) {
    console.error("release refused: production lookup does not deploy");
    process.exit(1);
  }
  const record = loadProductionRecord(loadReleasePolicy());
  if (!record) {
    console.log("null");
    process.exit(2);
  }
  console.log(JSON.stringify(record));
}

function main() {
  if (process.argv.includes("--record")) {
    recordAdvanceMain();
    return;
  }
  if (process.argv.includes("--production-json")) {
    productionJsonMain();
    return;
  }
  const cwd = process.cwd();
  const policy = loadReleasePolicy();
  const full = process.argv.includes("--full");
  const record = loadProductionRecord(policy);
  const head = git(cwd, ["rev-parse", "HEAD"]).trim();
  const status = git(cwd, ["status", "--porcelain"]);
  const snapshot = releaseSnapshot(cwd, head, status);
  const approved = approvedReleaseAt(cwd, head);
  let parent = null;
  try {
    parent = git(cwd, ["rev-parse", `${head}^`]).trim();
  } catch {
    parent = null;
  }
  const previousApproved = parent ? approvedReleaseAt(cwd, parent) : null;
  const baselineSha = approved?.sha && record?.sha === approved.sha ? approved.sha : record?.sha;
  const baseline = baselineSha ? readCommit(cwd, baselineSha) : null;
  const result = evaluateRelease({
    policy,
    remoteUrl: snapshot?.remoteUrl,
    branch: snapshot?.branch,
    status,
    files: snapshot?.files ?? [],
    baselineMigrations: baseline?.migrations ?? null,
    releaseMigrations: snapshot?.migrations ?? [],
    migrationsApproved: process.env.RELEASE_MIGRATIONS === "approved",
    record,
    approved,
    previousApproved,
    githubFailures: verifyGithubBranch(cwd, policy.productionBranch, approved?.sha, head),
    ancestor: approved?.sha ? commitContains(cwd, approved.sha, head) : null,
  });
  if (!result.ok) {
    for (const failure of result.failures) console.error(`release refused: ${failure}`);
    process.exit(1);
  }
  console.log(`release source ok ${head} contains approved production ${approved.sha} (${approved.deploymentId})`);
  if (!full) return;
  try {
    runFullChecks(cwd, policy);
  } catch {
    console.error("release refused: tests, typecheck, or production build failed");
    process.exit(1);
  }
  console.log("release checks passed");
}

const entry = process.argv[1]?.replaceAll("\\", "/");
if (entry?.endsWith("/scripts/release-guard.mjs")) main();
