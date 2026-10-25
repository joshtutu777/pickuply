import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

function assertLocalSupabaseUrl(url) {
  let hostname = "";
  try {
    hostname = new URL(url).hostname;
  } catch {
    throw new Error("Refusing: Supabase URL is not local.");
  }
  if (hostname !== "localhost" && hostname !== "127.0.0.1") {
    throw new Error("Refusing: Supabase URL is not local.");
  }
}

function assertAllowlistedPhone(phone, allowlist) {
  const digits = phone.replace(/\D/g, "");
  const ten = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  const allowed = new Set(
    allowlist
      .map((item) => item.replace(/\D/g, ""))
      .map((item) => (item.length === 11 && item.startsWith("1") ? item.slice(1) : item)),
  );
  if (!/^555\d{7}$/.test(ten) || !allowed.has(ten)) {
    throw new Error("Refusing: that phone is not on the local test allowlist.");
  }
  return ten;
}

function historyBlocksReset(counts) {
  const total = counts.jobs + counts.messages + counts.threads + counts.ledger + counts.offers + counts.disputes;
  if (total > 0) {
    return "Refusing: this test account has marketplace history. Use a fresh unused test number.";
  }
  return null;
}

// Deletes a local test account that has never joined a job, message, or payment.
// Refuses hosted URLs, unknown numbers, and any account with marketplace history.

const docker = process.env.DOCKER_BIN || "C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe";

function loadEnv(filename) {
  const values = {};
  const text = readFileSync(path.join(process.cwd(), filename), "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const body = trimmed.startsWith("export ") ? trimmed.slice(7).trim() : trimmed;
    const eq = body.indexOf("=");
    if (eq <= 0) continue;
    const key = body.slice(0, eq).trim();
    let value = body.slice(eq + 1).trim();
    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function sql(statement) {
  return execFileSync(
    docker,
    ["exec", "-i", "supabase_db_pickuply", "psql", "-U", "postgres", "-d", "postgres", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1"],
    { encoding: "utf8", input: statement },
  ).trim();
}

const fileEnv = loadEnv(".env.test.local");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL || fileEnv.NEXT_PUBLIC_SUPABASE_URL || "";
try {
  assertLocalSupabaseUrl(url);
} catch (error) {
  fail(error instanceof Error ? error.message : "Refusing: Supabase URL is not local.");
}

const allow = (fileEnv.TEST_RESET_ALLOWLIST || "")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);
let ten = "";
try {
  ten = assertAllowlistedPhone(process.argv[2] || "", allow);
} catch (error) {
  fail(error instanceof Error ? error.message : "Refusing: that phone is not on the local test allowlist.");
}

const phones = [`'${ten}'`, `'1${ten}'`, `'+1${ten}'`].join(", ");
const userId = sql(`select id from auth.users where phone in (${phones}) limit 1;`);
if (!userId) {
  console.log("That test number has no account.");
  process.exit(0);
}
if (!/^[0-9a-f-]{36}$/i.test(userId)) fail("Refusing: the account id was not readable.");

const counts = sql(`
  select
    (select count(*) from public.jobs where customer_id = '${userId}' or assigned_driver_id = '${userId}') || '|' ||
    (select count(*) from public.messages where sender_id = '${userId}') || '|' ||
    (select count(*) from public.message_threads where requester_id = '${userId}' or driver_id = '${userId}') || '|' ||
    (select count(*) from public.ledger_entries where driver_id = '${userId}') || '|' ||
    (select count(*) from public.job_offers where driver_id = '${userId}') || '|' ||
    (select count(*) from public.job_disputes d
      join public.jobs j on j.id = d.job_id
      where j.customer_id = '${userId}' or j.assigned_driver_id = '${userId}');
`);
const [jobs, messages, threads, ledger, offers, disputes] = counts.split("|").map((item) => Number(item));
const blocked = historyBlocksReset({
  jobs,
  messages,
  threads,
  ledger,
  offers,
  disputes,
});
if (blocked) fail(blocked);

sql(`
  begin;
  delete from public.vehicles where driver_id = '${userId}';
  delete from public.drivers where profile_id = '${userId}';
  delete from public.sms_consents where profile_id = '${userId}';
  delete from public.notifications where profile_id = '${userId}';
  delete from public.funnel_events where user_id = '${userId}';
  delete from public.push_subscriptions where profile_id = '${userId}';
  delete from public.audit_log where actor_id = '${userId}' or target_id = '${userId}';
  delete from public.profiles where id = '${userId}';
  delete from auth.identities where user_id = '${userId}';
  delete from auth.sessions where user_id = '${userId}';
  delete from auth.users where id = '${userId}';
  commit;
`);
console.log("Test account removed. The number can sign up again.");
