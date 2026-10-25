// Hosted roster provision. This does nothing unless the exact project flag is present.
// It does not replace scripts/provision-deployed-test-accounts.mjs, which still refuses hosted projects.
// Do not run this file until the owner approves that exact flag.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { deployedTestPhones } from "./deployed-test-target.mjs";
import { hostedRosterClaimFreshSql, hostedRosterCleanupSql, hostedRosterPrecheckSql } from "./hosted-test-accounts-sql.mjs";
import { assertHostedTestApproval, assertHostedTestTarget } from "./hosted-test-guard.mjs";

const docker = process.env.DOCKER_BIN || "C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe";

function fail(message) {
  console.error(message);
  process.exit(1);
}

function readEnvFile() {
  const values = new Map();
  const text = readFileSync(path.join(process.cwd(), ".env.local"), "utf8");
  for (const line of text.split(/\r?\n/)) {
    const eq = line.indexOf("=");
    if (eq <= 0 || line.trim().startsWith("#")) continue;
    values.set(line.slice(0, eq).trim(), line.slice(eq + 1).trim().replace(/^"|"$/g, ""));
  }
  return values;
}

function hostedSql(statement, password) {
  return execFileSync(
    docker,
    [
      "exec",
      "-e",
      "PGPASSWORD",
      "-i",
      "supabase_db_pickuply",
      "psql",
      "--host=aws-1-us-west-2.pooler.supabase.com",
      "--port=5432",
      "--username=postgres.uyhithfdmphilleusiom",
      "--dbname=postgres",
      "-v",
      "ON_ERROR_STOP=1",
      "-q",
      "-t",
      "-A",
    ],
    {
      encoding: "utf8",
      input: statement,
      env: { ...process.env, PGPASSWORD: password },
    },
  ).trim();
}

async function ensureAuthUser(url, service, phone, password) {
  const existing = hostedSql(
    `select id from auth.users where right(regexp_replace(phone, '\\D', '', 'g'), 10) = '${phone}' limit 1;`,
    password,
  );
  if (existing) return existing;

  const created = await fetch(`${url}/auth/v1/admin/users`, {
    method: "POST",
    headers: {
      apikey: service,
      Authorization: `Bearer ${service}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ phone: `+1${phone}`, phone_confirm: true }),
  });
  if (!created.ok) fail("Could not create a missing test phone.");
  const user = await created.json();
  return user.id ?? user.user?.id ?? "";
}

async function main() {
  let approval;
  try {
    approval = assertHostedTestApproval(process.argv);
  } catch (error) {
    fail(error instanceof Error ? error.message : "Refusing.");
  }

  const env = readEnvFile();
  const url = env.get("NEXT_PUBLIC_SUPABASE_URL") ?? "";
  const service = env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const password = env.get("SUPABASE_DB_PASSWORD") ?? "";
  try {
    assertHostedTestTarget(url, approval.ref);
  } catch (error) {
    fail(error instanceof Error ? error.message : "Refusing.");
  }
  if (!service || !password) fail("Hosted service credentials are missing.");

  if (approval.action === "cleanup") {
    hostedSql(hostedRosterCleanupSql(), password);
    console.log("Removed hosted synthetic profiles that were already marked is_test. Real profiles were not changed.");
    return;
  }

  hostedSql(hostedRosterPrecheckSql(), password);
  for (const phone of deployedTestPhones) {
    const id = await ensureAuthUser(url, service, phone, password);
    if (!id) fail("A test profile was not created.");
  }
  // New sign-ups start as ordinary customers. Mark only an empty new profile.
  // A profile that already has a name or any job fails this step before the fixture runs.
  hostedSql(hostedRosterClaimFreshSql(), password);
  const fixture = readFileSync(path.join(process.cwd(), "scripts/sql/deployed-test-accounts.sql"), "utf8");
  hostedSql(fixture, password);
  const marked = hostedSql(
    `select count(*) from public.profiles where is_test = true and right(regexp_replace(phone, '\\D', '', 'g'), 10) in (${deployedTestPhones.map((phone) => `'${phone}'`).join(", ")});`,
    password,
  );
  if (marked !== "13") fail("The hosted roster was not marked is_test.");
  const payouts = hostedSql(
    "select count(*) from public.driver_connect_accounts where payouts_enabled = true and driver_id in (select id from public.profiles where is_test = true);",
    password,
  );
  if (payouts !== "0") fail("A test account has payouts enabled.");
  console.log("Hosted synthetic roster is ready. No SMS was sent and no payout was enabled.");
}

const entry = process.argv[1] ?? "";
if (entry.endsWith("provision-hosted-test-accounts.mjs")) {
  main();
}
