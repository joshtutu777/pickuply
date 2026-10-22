import { spawn } from "node:child_process";

const customer = "e1111111-1111-4111-8111-111111111111";
const driver = "e4444444-4444-4444-8444-444444444444";
const driver2 = "e5555555-5555-4555-8555-555555555555";
const claimJob = "eaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const chooseJob = "eaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";

const setup = `
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
) values
  ('00000000-0000-0000-0000-000000000000', '${customer}', 'authenticated', 'authenticated', 'race-customer@pickuply.test', 'test-hash', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), '${customer}', '', '${customer}-email', '${customer}-recovery'),
  ('00000000-0000-0000-0000-000000000000', '${driver}', 'authenticated', 'authenticated', 'race-driver@pickuply.test', 'test-hash', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), '${driver}', '', '${driver}-email', '${driver}-recovery'),
  ('00000000-0000-0000-0000-000000000000', '${driver2}', 'authenticated', 'authenticated', 'race-driver2@pickuply.test', 'test-hash', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), '${driver2}', '', '${driver2}-email', '${driver2}-recovery')
on conflict (id) do nothing;
update public.profiles set role = 'driver', full_name = 'Race Driver' where id in ('${driver}', '${driver2}');
update public.profiles set full_name = 'Race Customer' where id = '${customer}';
insert into public.drivers (
  profile_id, status, zone_id, service_level, services, max_distance_miles, is_online,
  license_expires, insurance_expires, insurance_url
)
select id, 'active', (select id from public.zones where slug = 'west_metro'), 'full',
  array['delivery']::public.job_service[], 25, true, current_date + 30, current_date + 30, id::text || '/insurance.jpg'
from public.profiles
where id in ('${driver}', '${driver2}')
on conflict (profile_id) do update set is_online = true, status = 'active';
insert into public.vehicles (driver_id, type, make, approved)
select id, 'pickup', 'Ford', true from public.profiles where id in ('${driver}', '${driver2}')
and not exists (select 1 from public.vehicles where driver_id = profiles.id);
select set_config('pickuply.quote_accepted', 'yes', false);
insert into public.jobs (
  id, customer_id, service, status, zone_id, pickup_area, description, pieces, size,
  item_value_cents, stairs_pickup, elevator, help_loading, preferred_date,
  pricing_method, offer_cents, service_level, required_vehicle,
  price_cents, driver_pay_cents, platform_fee_cents, service_fee_cents, quote_expires_at
) values
  ('${claimJob}', '${customer}', 'delivery', 'open', (select id from public.zones where slug = 'west_metro'),
   'Austell', 'race claim', 1, 'medium', 0, 0, false, false, 'asap', 'quote', null, 'full', 'pickup',
   7240, 6000, 1000, 240, now() + interval '2 hours'),
  ('${chooseJob}', '${customer}', 'delivery', 'open', (select id from public.zones where slug = 'west_metro'),
   'Austell', 'race choose', 1, 'medium', 0, 0, false, false, 'asap', 'fixed', 15000, 'full', 'pickup',
   null, null, null, null, null)
on conflict (id) do nothing;
`;

const cleanup = `
delete from public.job_events where job_id in ('${claimJob}', '${chooseJob}');
delete from public.job_offers where job_id in ('${claimJob}', '${chooseJob}');
delete from public.jobs where id in ('${claimJob}', '${chooseJob}');
delete from public.vehicles where driver_id in ('${driver}', '${driver2}');
delete from public.drivers where profile_id in ('${driver}', '${driver2}');
delete from public.profiles where id in ('${customer}', '${driver}', '${driver2}');
delete from auth.users where id in ('${customer}', '${driver}', '${driver2}');
`;

function sessionSql(userId, statement) {
  return `
select set_config('request.jwt.claim.sub', '${userId}', false);
select set_config('request.jwt.claim.role', 'authenticated', false);
select set_config('request.jwt.claims', json_build_object('sub', '${userId}', 'role', 'authenticated')::text, false);
set role authenticated;
select pg_sleep(0.4);
${statement}
`;
}

function query(sql) {
  return new Promise((resolve) => {
    const child = spawn(
      "docker",
      [
        "exec",
        "-i",
        "supabase_db_pickuply",
        "psql",
        "-U",
        "postgres",
        "-d",
        "postgres",
        "-v",
        "ON_ERROR_STOP=1",
        "-q",
        "-t",
        "-A",
      ],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    child.stdin.write(sql);
    child.stdin.end();
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

function oneLine(result, label) {
  const text = `${result.stdout}\n${result.stderr}`;
  const line = text
    .split(/\r?\n/)
    .map((item) => item.trim())
    .find((item) => item.includes("|") || item.toLowerCase().includes("error") || item.toLowerCase().includes("exception"));
  console.log(`${label}: exit ${result.code} ${line ?? "no row"}`);
  return text;
}

await query(cleanup);
const setupResult = await query(setup);
if (setupResult.code !== 0) {
  console.log(oneLine(setupResult, "setup"));
  process.exit(1);
}

await query(sessionSql(driver, `select public.submit_offer('${chooseJob}', 'accept', null, null);`));
await query(sessionSql(driver2, `select public.submit_offer('${chooseJob}', 'counter', 8000, 'stairs');`));

const [claimA, claimB] = await Promise.all([
  query(sessionSql(driver, `select public.claim_job('${claimJob}');`)),
  query(sessionSql(driver2, `select public.claim_job('${claimJob}');`)),
]);
oneLine(claimA, "claim A");
oneLine(claimB, "claim B");

const claimCount = await query(
  `select count(distinct assigned_driver_id)::text || '|' || count(*)::text from public.jobs where id = '${claimJob}' and status = 'assigned'`,
);
const claimLine = oneLine(claimCount, "claim winners");

const offers = await query(
  `select id::text || '|' || driver_id::text from public.job_offers where job_id = '${chooseJob}' and status = 'active'`,
);
const offerIds = offers.stdout
  .split(/\r?\n/)
  .map((line) => line.trim().split("|")[0])
  .filter((id) => /^[0-9a-f-]{36}$/i.test(id));
if (offerIds.length !== 2) {
  console.log(offers.stdout);
  console.log(offers.stderr);
  throw new Error(`expected two active offers, found ${offerIds.length}`);
}

const [chooseA, chooseB] = await Promise.all([
  query(sessionSql(customer, `select public.choose_offer('${offerIds[0]}');`)),
  query(sessionSql(customer, `select public.choose_offer('${offerIds[1]}');`)),
]);
oneLine(chooseA, "choose A");
oneLine(chooseB, "choose B");

const chooseCount = await query(
  `select count(distinct assigned_driver_id)::text || '|' || (select count(*)::text from public.job_offers where job_id = '${chooseJob}' and status = 'chosen') from public.jobs where id = '${chooseJob}' and status = 'assigned'`,
);
const chooseLine = oneLine(chooseCount, "choose winners");

await query(cleanup);

const claimOk = claimLine.includes("1|1");
const chooseOk = chooseLine.includes("1|1");
if (!claimOk || !chooseOk) process.exit(1);
console.log("concurrent assignment produced one driver for both paths");
