import { appendFileSync, readFileSync } from "node:fs";
import { loadReleasePolicy } from "./release-guard.mjs";

const shaPattern = /^[0-9a-f]{40}$/;
const deploymentPattern = /^dpl_[A-Za-z0-9]+$/;
const targetPattern = /^(?:https:\/\/[A-Za-z0-9.-]+\.vercel\.app|dpl_[A-Za-z0-9]+)$/;

export function extractDeploymentRefs(text) {
  const source = String(text ?? "");
  const urls = [...source.matchAll(/https:\/\/[A-Za-z0-9.-]+\.vercel\.app\b/g)].map((match) => match[0]);
  const ids = [...source.matchAll(/\bdpl_[A-Za-z0-9]+\b/g)].map((match) => match[0]);
  return { urls: [...new Set(urls)], ids: [...new Set(ids)] };
}

export function deploymentTarget(text) {
  const refs = extractDeploymentRefs(text);
  const url = refs.urls.find((item) => targetPattern.test(item));
  if (url) return url;
  const id = refs.ids.find((item) => targetPattern.test(item));
  return id ?? "";
}

export function verifyDeployment(detail, expectedSha, host) {
  if (!detail || typeof detail !== "object") {
    return { ok: false, failures: ["deployment could not be inspected"], deploymentId: null };
  }
  const failures = [];
  const deploymentId = deploymentPattern.test(detail.id ?? "") ? detail.id : null;
  if (!deploymentId) failures.push("deployment id is missing");
  if (detail.readyState !== "READY") failures.push(`deployment is ${detail.readyState || "unverified"}`);
  if (detail.target !== "production") failures.push("deployment is not a production target");
  const aliases = Array.isArray(detail.alias) ? detail.alias : [];
  if (!aliases.includes(host)) failures.push(`deployment is not serving ${host}`);
  const sha = detail.meta?.gitCommitSha ?? "";
  if (sha !== expectedSha) failures.push("deployment commit does not match the reviewed commit");
  return { ok: failures.length === 0, failures, deploymentId };
}

function servesExpected(record, expectedSha, host, deploymentId) {
  if (!record) return false;
  const aliases = Array.isArray(record.aliases) ? record.aliases : [];
  return (
    record.readyState === "READY" &&
    record.target === "production" &&
    aliases.includes(host) &&
    record.sha === expectedSha &&
    record.deploymentId === deploymentId &&
    deploymentPattern.test(record.deploymentId ?? "")
  );
}

function matchesApproved(record, approved, host) {
  if (!record || !approved) return false;
  const aliases = Array.isArray(record.aliases) ? record.aliases : [];
  return (
    record.readyState === "READY" &&
    aliases.includes(host) &&
    record.sha === approved.sha &&
    record.deploymentId === approved.deploymentId
  );
}

export function buildDeploymentReport(input) {
  const host = input.host;
  const created = extractDeploymentRefs(`${input.deployStdout ?? ""}\n${input.deployStderr ?? ""}`);
  const inspected = verifyDeployment(input.inspected ?? null, input.expectedSha, host);
  const lines = [];
  for (const id of created.ids) lines.push(`created deployment ${id}`);
  if (inspected.deploymentId && !created.ids.includes(inspected.deploymentId)) {
    lines.push(`inspected deployment ${inspected.deploymentId}`);
  }
  if (created.ids.length === 0 && !inspected.deploymentId) lines.push("no Vercel deployment id was found");
  if (created.ids.length > 1) {
    lines.push("more than one deployment id was reported; this job did not choose one or deploy again");
  }
  if (input.deployExitCode !== 0) lines.push(`deploy command exited ${input.deployExitCode}; it was not retried`);
  const attemptedInspect = input.deployExitCode === 0 || created.ids.length > 0 || created.urls.length > 0;
  if (attemptedInspect && input.inspectExitCode !== 0) lines.push("deployment inspection failed; it was not retried");
  if (input.inspected) {
    for (const failure of inspected.failures) lines.push(failure);
  }

  const live = input.live;
  if (live) {
    lines.push(`current production deployment ${live.deploymentId}`);
    if (live.sha) lines.push(`current production commit ${live.sha}`);
  } else if (live === null) {
    lines.push("current production deployment could not be verified");
    lines.push("future releases are blocked until production can be verified");
  } else {
    lines.push("current production has not been checked");
  }

  const serving = servesExpected(live, input.expectedSha, host, inspected.deploymentId);
  const approvedMatches = matchesApproved(live, input.approved, host);
  const ok =
    input.deployExitCode === 0 &&
    input.inspectExitCode === 0 &&
    created.ids.length < 2 &&
    inspected.ok &&
    serving;
  if (live && !ok) {
    lines.push(
      approvedMatches
        ? "current production still matches the approved record"
        : "approved baseline no longer matches production; future releases are blocked",
    );
  }
  if (ok) {
    lines.push(`verified deployment ${inspected.deploymentId}`);
    lines.push("future releases are blocked until the approved record is updated to this deployment");
  }
  lines.push("this job did not roll back, redeploy, or edit the approved release record");
  return {
    ok,
    lines,
    deploymentId: inspected.deploymentId ?? created.ids[0] ?? null,
    createdIds: created.ids,
  };
}

export function nextApprovedRecord(policy, sha, deploymentId) {
  if (!shaPattern.test(sha ?? "") || !deploymentPattern.test(deploymentId ?? "")) return null;
  return {
    repository: policy.repository,
    branch: policy.productionBranch,
    sha,
    deploymentId,
  };
}

function readJsonFile(path) {
  if (!path) return undefined;
  try {
    const text = readFileSync(path, "utf8").replace(/^\uFEFF/, "");
    const start = text.search(/[\[{]|null\b/);
    if (start < 0) return null;
    const value = JSON.parse(text.slice(start));
    return value === null ? null : value;
  } catch {
    return null;
  }
}

function option(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function writeGithubOutput(report) {
  const path = process.env.GITHUB_OUTPUT;
  if (!path || !report.deploymentId || !deploymentPattern.test(report.deploymentId)) return;
  const created = report.createdIds.find((id) => deploymentPattern.test(id));
  const lines = [`deployment-id=${report.deploymentId}`];
  if (created) lines.push(`created-id=${created}`);
  appendFileSync(path, `${lines.join("\n")}\n`);
}

function targetMain() {
  const stdout = option("--stdout") ? readFileSync(option("--stdout"), "utf8") : "";
  const stderr = option("--stderr") ? readFileSync(option("--stderr"), "utf8") : "";
  process.stdout.write(deploymentTarget(`${stdout}\n${stderr}`));
}

function reportMain() {
  const policy = loadReleasePolicy();
  const approved = readJsonFile(option("--approved"));
  const report = buildDeploymentReport({
    host: policy.productionHost,
    expectedSha: option("--expected-sha"),
    deployExitCode: Number(option("--deploy-exit")),
    inspectExitCode: Number(option("--inspect-exit")),
    deployStdout: option("--deploy-stdout") ? readFileSync(option("--deploy-stdout"), "utf8") : "",
    deployStderr: option("--deploy-stderr") ? readFileSync(option("--deploy-stderr"), "utf8") : "",
    inspected: readJsonFile(option("--inspect")),
    live: readJsonFile(option("--live")),
    approved,
  });
  for (const line of report.lines) console.error(line);
  writeGithubOutput(report);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${report.lines.join("\n")}\n`);
  }
  if (!report.ok) process.exit(1);
  const record = nextApprovedRecord(policy, option("--expected-sha"), report.deploymentId);
  if (!record) process.exit(1);
  console.log(JSON.stringify(record));
}

function recordMain() {
  const record = nextApprovedRecord(loadReleasePolicy(), process.env.SHA, process.env.DEPLOYMENT_ID);
  if (!record) process.exit(1);
  console.log(JSON.stringify(record, null, 2));
  console.log("Do not deploy the follow-up commit. Commit only scripts/approved-release.json, then run node scripts/release-guard.mjs --record.");
}

function main() {
  if (process.argv.includes("target")) {
    targetMain();
    return;
  }
  if (process.argv.includes("report")) {
    reportMain();
    return;
  }
  if (process.argv.includes("record")) {
    recordMain();
    return;
  }
  process.exit(1);
}

const entry = process.argv[1]?.replaceAll("\\", "/");
if (entry?.endsWith("/scripts/release-deploy-report.mjs")) main();
