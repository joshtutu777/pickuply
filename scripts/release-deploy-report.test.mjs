import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  buildDeploymentReport,
  deploymentTarget,
  evaluatePreDeployment,
  nextApprovedRecord,
} from "./release-deploy-report.mjs";
import { loadReleasePolicy } from "./release-guard.mjs";

const policy = loadReleasePolicy();
const reviewed = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const approved = {
  repository: policy.repository,
  branch: policy.productionBranch,
  sha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  deploymentId: "dpl_olddeploy",
};
const readyDetail = {
  id: "dpl_newdeploy",
  readyState: "READY",
  target: "production",
  alias: [policy.productionHost],
  meta: { gitCommitSha: reviewed },
};
const readyLive = {
  deploymentId: "dpl_newdeploy",
  sha: reviewed,
  readyState: "READY",
  target: "production",
  aliases: [policy.productionHost],
};
const previousLive = {
  deploymentId: approved.deploymentId,
  sha: approved.sha,
  readyState: "READY",
  target: "production",
  aliases: [policy.productionHost],
};

function report(patch) {
  return buildDeploymentReport({
    host: policy.productionHost,
    expectedSha: reviewed,
    deployExitCode: 0,
    inspectExitCode: 0,
    deployStdout: "https://pickuply-reviewed.vercel.app\n",
    deployStderr: "",
    inspected: readyDetail,
    live: readyLive,
    approved,
    ...patch,
  });
}

test("a verified deployment is accepted once and names its id", () => {
  const result = report();
  assert.equal(result.ok, true);
  assert.equal(result.deploymentId, "dpl_newdeploy");
  assert.ok(result.lines.includes("verified deployment dpl_newdeploy"));
  assert.ok(result.lines.includes("future releases are blocked until the approved record is updated to this deployment"));
  assert.ok(result.lines.includes("this job did not roll back, redeploy, or edit the approved release record"));
  assert.equal(result.lines.some((line) => line.includes("was not retried")), false);
});

test("a failed deploy reports its id and does not retry when production is unchanged", () => {
  const result = report({
    deployExitCode: 1,
    inspectExitCode: 1,
    deployStdout: "",
    deployStderr: "Error: https://pickuply-reviewed.vercel.app\nCreated dpl_newdeploy\n",
    inspected: null,
    live: previousLive,
  });
  assert.equal(result.ok, false);
  assert.ok(result.lines.includes("created deployment dpl_newdeploy"));
  assert.ok(result.lines.includes("deploy command exited 1; it was not retried"));
  assert.ok(result.lines.includes("current production deployment dpl_olddeploy"));
  assert.ok(result.lines.includes("current production still matches the approved record"));
  assert.equal(result.lines.some((line) => line.includes("vercel deploy")), false);
});

test("an uncertain or wrong deployment is reported and blocks a moved baseline", () => {
  const building = report({
    inspected: { ...readyDetail, readyState: "BUILDING" },
    live: previousLive,
  });
  assert.equal(building.ok, false);
  assert.ok(building.lines.includes("deployment is BUILDING"));
  assert.equal(building.lines.some((line) => line.startsWith("created deployment ")), false);
  assert.ok(building.lines.includes("inspected deployment dpl_newdeploy"));
  assert.equal(building.deploymentId, "dpl_newdeploy");

  const wrongDomain = report({
    inspected: { ...readyDetail, alias: ["preview.example"] },
    live: { ...readyLive, aliases: ["preview.example"] },
  });
  assert.equal(wrongDomain.ok, false);
  assert.ok(wrongDomain.lines.some((line) => line.includes(policy.productionHost)));
  assert.ok(wrongDomain.lines.includes("approved baseline no longer matches production; future releases are blocked"));

  const unrelated = report({
    inspected: { ...readyDetail, meta: { gitCommitSha: approved.sha } },
    live: previousLive,
  });
  assert.equal(unrelated.ok, false);
  assert.ok(unrelated.lines.includes("deployment commit does not match the reviewed commit"));

  const missing = report({
    deployExitCode: 1,
    inspectExitCode: 1,
    deployStdout: "deployment failed\n",
    inspected: null,
    live: null,
  });
  assert.equal(missing.ok, false);
  assert.ok(missing.lines.includes("no Vercel deployment id was found"));
  assert.ok(missing.lines.includes("current production deployment could not be verified"));
  assert.ok(missing.lines.includes("future releases are blocked until production can be verified"));

  const ambiguous = report({
    deployStdout: "https://pickuply-reviewed.vercel.app\ndpl_newdeploy\ndpl_otherdeploy\n",
  });
  assert.equal(ambiguous.ok, false);
  assert.ok(ambiguous.lines.includes("created deployment dpl_newdeploy"));
  assert.ok(ambiguous.lines.includes("created deployment dpl_otherdeploy"));
  assert.ok(ambiguous.lines.includes("more than one deployment id was reported; this job did not choose one or deploy again"));
});

test("the deployment target accepts one safe url and the follow-up record is exact", () => {
  assert.equal(deploymentTarget("Production: https://pickuply-reviewed.vercel.app\n"), "https://pickuply-reviewed.vercel.app");
  assert.equal(deploymentTarget("see dpl_newdeploy"), "dpl_newdeploy");
  assert.equal(deploymentTarget("https://pickuplyapp.com"), "");
  const record = nextApprovedRecord(policy, reviewed, "dpl_newdeploy");
  assert.deepEqual(record, {
    repository: policy.repository,
    branch: "main",
    sha: reviewed,
    deploymentId: "dpl_newdeploy",
  });
  assert.equal(nextApprovedRecord(policy, "main", "dpl_newdeploy"), null);
  assert.equal(nextApprovedRecord(policy, reviewed, "preview"), null);
});

test("the report command records a failed deployment id without deploying", () => {
  const dir = mkdtempSync(join(tmpdir(), "pickuply-deploy-report-"));
  const outputPath = join(dir, "github-output.txt");
  writeFileSync(outputPath, "");
  writeFileSync(join(dir, "stdout.txt"), "");
  writeFileSync(join(dir, "stderr.txt"), "Error for dpl_newdeploy\n");
  writeFileSync(join(dir, "live.json"), JSON.stringify(previousLive));
  writeFileSync(join(dir, "approved.json"), JSON.stringify(approved));
  let thrown = null;
  try {
    execFileSync(
      process.execPath,
      [
        fileURLToPath(new URL("./release-deploy-report.mjs", import.meta.url)),
        "report",
        "--deploy-stdout",
        join(dir, "stdout.txt"),
        "--deploy-stderr",
        join(dir, "stderr.txt"),
        "--deploy-exit",
        "1",
        "--inspect",
        join(dir, "missing-inspect.json"),
        "--inspect-exit",
        "1",
        "--live",
        join(dir, "live.json"),
        "--approved",
        join(dir, "approved.json"),
        "--expected-sha",
        reviewed,
      ],
      {
        cwd: fileURLToPath(new URL("..", import.meta.url)),
        encoding: "utf8",
        env: { ...process.env, GITHUB_OUTPUT: outputPath },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
  } catch (error) {
    thrown = error;
  } finally {
    const saved = readFileSync(outputPath, "utf8");
    rmSync(dir, { recursive: true, force: true });
    assert.ok(thrown, "an uncertain deploy was accepted");
    assert.equal(thrown.status, 1);
    assert.match(`${thrown.stdout ?? ""}\n${thrown.stderr ?? ""}`, /created deployment dpl_newdeploy/);
    assert.match(saved, /deployment-id=dpl_newdeploy/);
    assert.doesNotMatch(`${thrown.stdout ?? ""}\n${thrown.stderr ?? ""}`, /vercel deploy/);
  }
});

test("a release is refused when production moved, is already current, or another release is open", () => {
  const requested = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const approved = {
    repository: policy.repository,
    branch: "main",
    sha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    deploymentId: "dpl_olddeploy",
  };
  const live = {
    deploymentId: approved.deploymentId,
    sha: approved.sha,
    readyState: "READY",
    target: "production",
    aliases: [policy.productionHost],
  };
  const base = {
    host: policy.productionHost,
    requestedSha: requested,
    mainTip: requested,
    live,
    approved,
    deployments: [{ deploymentId: approved.deploymentId, sha: approved.sha, readyState: "READY", target: "production" }],
    runs: { workflow_runs: [{ id: 9, name: "Production release", status: "in_progress" }] },
    currentRunId: "9",
  };
  assert.deepEqual(evaluatePreDeployment(base).failures, []);
  assert.ok(evaluatePreDeployment({ ...base, live: { ...live, sha: requested } }).failures.includes("requested commit is already serving production"));
  assert.ok(
    evaluatePreDeployment({ ...base, live: { ...live, deploymentId: "dpl_otherdeploy" } }).failures.includes(
      "live production does not match the approved release record",
    ),
  );
  assert.ok(
    evaluatePreDeployment({ ...base, mainTip: approved.sha }).failures.includes("requested commit is not the current main tip"),
  );
  assert.ok(
    evaluatePreDeployment({
      ...base,
      deployments: [...base.deployments, { deploymentId: "dpl_building", sha: "", readyState: "BUILDING", target: "production" }],
    }).failures.includes("a production deployment is still in progress"),
  );
  assert.ok(
    evaluatePreDeployment({
      ...base,
      deployments: [...base.deployments, { deploymentId: "dpl_newdeploy", sha: requested, readyState: "ERROR", target: "production" }],
    }).failures.includes("a deployment for the requested commit already exists"),
  );
  assert.ok(evaluatePreDeployment({ ...base, runs: null }).failures.includes("could not verify whether another release is in progress"));
  assert.ok(
    evaluatePreDeployment({
      ...base,
      runs: { workflow_runs: [{ id: 10, name: "Production release", status: "waiting" }] },
    }).failures.includes("another production release is in progress"),
  );
});

test("the draft workflow is manual, read-only, and deploys at most once", () => {
  const workflow = readFileSync(new URL("../docs/release/production-release.workflow.yml", import.meta.url), "utf8").replaceAll("\r\n", "\n");
  const onBlock = workflow.slice(workflow.indexOf('\n"on":'), workflow.indexOf("\npermissions:"));
  assert.match(onBlock, /workflow_dispatch:/);
  assert.match(onBlock, /sha:/);
  assert.match(onBlock, /approval:/);
  assert.match(onBlock, /default: checks-only/);
  assert.doesNotMatch(onBlock, /push:|pull_request:|schedule:|workflow_run:/);
  assert.match(workflow, /contents: read/);
  assert.match(workflow, /actions: read/);
  assert.doesNotMatch(workflow, /contents: write|actions: write|deployments: write/);
  assert.match(workflow, /environment: production/);
  assert.match(workflow, /uses: actions\/checkout@11d5960a326750d5838078e36cf38b85af677262/);
  assert.doesNotMatch(workflow, /actions\/checkout@v|npx /);
  assert.match(workflow, /ref: \$\{\{ inputs\.sha \}\}/);
  assert.match(workflow, /test "\$\(git rev-parse origin\/main\)" = "\$SHA"/);
  assert.match(workflow, /if: inputs\.approval == 'approved'/);
  assert.match(workflow, /if: success\(\) && inputs\.approval == 'approved'/);
  const preflight = workflow.indexOf("release-deploy-report.mjs preflight");
  const deploy = workflow.indexOf("node_modules/vercel/dist/vc.js deploy");
  assert.ok(preflight > 0 && deploy > preflight);
  assert.equal(workflow.match(/vc\.js deploy/g).length, 1);
  assert.equal(workflow.match(/vc\.js inspect/g).length, 1);
  assert.equal(workflow.match(/--production-json/g).length, 2);
  assert.equal(workflow.match(/--production-list/g).length, 1);
  assert.doesNotMatch(workflow, /vercel rollback|vercel promote|supabase|git commit|git push|RELEASE_MIGRATIONS|--verify|--env /);
  assert.equal(workflow.includes("cancel-in-progress: false"), true);
  const installed = new URL("../.github/workflows/production-release.yml", import.meta.url);
  assert.throws(() => readFileSync(installed));
});
