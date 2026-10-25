// Creates the 13 synthetic roster on local Supabase only.
// Does not set an OTP, does not call Twilio, and refuses the production project.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { assertSafeTestTarget, deployedTestPhones } from "./deployed-test-target.mjs";

const docker = process.env.DOCKER_BIN || "C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe";

function fail(message) {
  console.error(message);
  process.exit(1);
}

function localStatus() {
  const text = execFileSync("npx supabase status -o env", { encoding: "utf8", shell: true });
  const values = new Map();
  for (const line of text.split(/\r?\n/)) {
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    values.set(line.slice(0, eq), line.slice(eq + 1).replace(/^"|"$/g, ""));
  }
  return {
    url: values.get("API_URL") ?? "",
    service: values.get("SERVICE_ROLE_KEY") ?? "",
  };
}

function sql(statement) {
  return execFileSync(
    docker,
    ["exec", "-i", "supabase_db_pickuply", "psql", "-U", "postgres", "-d", "postgres", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1"],
    { encoding: "utf8", input: statement },
  ).trim();
}

async function ensureAuthUser(url, service, phone) {
  const existing = sql(
    `select id from auth.users where right(regexp_replace(phone, '\\D', '', 'g'), 10) = '${phone}' limit 1;`,
  );
  if (existing) return existing;
  const response = await fetch(`${url}/auth/v1/admin/users`, {
    method: "POST",
    headers: {
      apikey: service,
      Authorization: `Bearer ${service}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ phone: `+1${phone}`, phone_confirm: true }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Could not create ${phone.slice(-4)}: ${response.status} ${text.slice(0, 180)}`);
  }
  const body = await response.json();
  return body.id ?? body.user?.id ?? "";
}

async function main() {
  const status = localStatus();
  try {
    assertSafeTestTarget(status.url);
  } catch (error) {
    fail(error instanceof Error ? error.message : "Refusing.");
  }
  if (!status.service) fail("Local Supabase service role is missing.");

  if (process.argv.includes("--cleanup")) {
    const listed = deployedTestPhones.map((phone) => `'${phone}'`).join(", ");
    sql(`
      begin;
      create temporary table roster on commit drop as
      select id from public.profiles
      where right(regexp_replace(phone, '\\D', '', 'g'), 10) in (${listed});
      create temporary table roster_jobs on commit drop as
      select id from public.jobs
      where customer_id in (select id from roster)
         or assigned_driver_id in (select id from roster);
      delete from public.ledger_entries where driver_id in (select id from roster) or job_id in (select id from roster_jobs);
      delete from public.job_disputes where job_id in (select id from roster_jobs);
      delete from public.job_reports where job_id in (select id from roster_jobs) or reporter_id in (select id from roster);
      delete from public.job_reviews where job_id in (select id from roster_jobs) or reviewer_id in (select id from roster);
      delete from public.notifications where profile_id in (select id from roster) or job_id in (select id from roster_jobs);
      delete from public.job_events where job_id in (select id from roster_jobs);
      delete from public.job_private where job_id in (select id from roster_jobs);
      delete from public.job_payments where job_id in (select id from roster_jobs);
      delete from public.jobs where id in (select id from roster_jobs);
      delete from auth.users where id in (select id from roster);
      commit;
    `);
    console.log("Removed the local synthetic roster. No hosted project was changed.");
    return;
  }

  for (const phone of deployedTestPhones) {
    const id = await ensureAuthUser(status.url, status.service, phone);
    if (!id) fail(`Auth user for ${phone.slice(-4)} was not created.`);
  }

  const fixture = readFileSync(path.join(process.cwd(), "scripts/sql/deployed-test-accounts.sql"), "utf8");
  sql(fixture);
  const summary = sql(`
    select seed.phone || ' ' || profiles.role::text || ' ' || coalesce(drivers.status::text, '-') || ' ' || coalesce(drivers.is_online::text, '-')
    from (values
      ('5555550301'), ('5555550302'), ('5555550303'), ('5555550304'), ('5555550305'),
      ('5555550306'), ('5555550307'), ('5555550308'), ('5555550309'), ('5555550310'),
      ('5555550311'), ('5555550312'), ('5555550313')
    ) as seed(phone)
    join public.profiles on right(regexp_replace(profiles.phone, '\\D', '', 'g'), 10) = seed.phone
    left join public.drivers on drivers.profile_id = profiles.id
    order by seed.phone;
  `);
  const jobs = sql(`
    select count(*) from public.jobs
    where id in (
      'c1300000-0000-4000-8000-000000000302',
      'c1300000-0000-4000-8000-000000000303',
      'c1300000-0000-4000-8000-000000000304',
      'c1300000-0000-4000-8000-000000000305',
      'c1300000-0000-4000-8000-000000000313'
    );
  `);
  const payouts = sql(`
    select coalesce(bool_or(payouts_enabled), false)
    from public.driver_connect_accounts
    where stripe_account_id = 'acct_testpickuply0309';
  `);
  const queued = sql(`
    select count(*) from public.notifications n
    join public.profiles on profiles.id = n.profile_id
    where right(regexp_replace(profiles.phone, '\\D', '', 'g'), 10) between '5555550301' and '5555550313';
  `);
  console.log(summary);
  console.log(`fixture_jobs=${jobs}`);
  console.log(`payouts_enabled=${payouts}`);
  console.log(`queued_notifications=${queued}`);
  console.log("Local roster is ready. Sign-in codes are not stored. Hosted Supabase was not changed.");
}

main().catch((error) => fail(error instanceof Error ? error.message : "The roster could not be prepared."));
