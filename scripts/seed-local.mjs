import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

// Repeatable local requests for the placeholder phones in supabase/config.toml.
// The API key is read from gitignored .env.test.local and is never printed.

const robinQuoteId = "01770000-0000-4000-8000-000000000001";
const robinJunkId = "01770000-0000-4000-8000-000000000002";
const novaRequestId = "01880000-0000-4000-8000-000000000001";

const people = [
  { phone: "+15555550177", otp: "101177", name: "Robin Returning" },
  { phone: "+15555550188", otp: "101188", name: "Nova Customer" },
];

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

function sql(statement) {
  return execFileSync(
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
      "-t",
      "-A",
    ],
    { input: statement, encoding: "utf8" },
  ).trim();
}

async function session(url, apiKey, person) {
  const send = await fetch(`${url}/auth/v1/otp`, {
    method: "POST",
    headers: { apikey: apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ phone: person.phone }),
  });
  if (!send.ok) throw new Error(`Could not send a local code (${send.status}).`);
  const verify = await fetch(`${url}/auth/v1/verify`, {
    method: "POST",
    headers: { apikey: apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ phone: person.phone, token: person.otp, type: "sms" }),
  });
  if (!verify.ok) throw new Error(`Could not verify a local code (${verify.status}).`);
  const body = await verify.json();
  if (!body.access_token) throw new Error("Local sign-in did not return a session.");
  return body.access_token;
}

async function createRequest(url, apiKey, token, requestId, payload) {
  const response = await fetch(`${url}/rest/v1/rpc/create_customer_request`, {
    method: "POST",
    headers: {
      apikey: apiKey,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ request_id: requestId, payload }),
  });
  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Could not save a request (${response.status}): ${message.slice(0, 180)}`);
  }
}

function shared(person, description) {
  return {
    description,
    pieces: "1",
    size: "medium",
    item_value_cents: "8000",
    stairs_pickup: "0",
    elevator: false,
    help_loading: true,
    preferred_date: "asap",
    source: "nextdoor",
    pickup_area: "Austell, 30106",
    pickup_address: "10 Secret Street",
    customer_name: person.name,
    customer_phone: person.phone,
  };
}

const env = loadEnv(".env.test.local");
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const apiKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url?.includes("127.0.0.1") || !apiKey) {
  throw new Error("seed:local needs the local Supabase URL and anon key in .env.test.local.");
}

const tokens = {};
for (const person of people) {
  tokens[person.phone] = await session(url, apiKey, person);
}

sql(`
alter table public.job_photos disable trigger job_photos_lock;
delete from public.job_photos
where job_id in (
  select jobs.id
  from public.jobs
  join public.profiles on profiles.id = jobs.customer_id
  where profiles.phone in ('15555550177', '+15555550177', '15555550188', '+15555550188')
);
delete from public.jobs
where customer_id in (
  select id from public.profiles
  where phone in ('15555550177', '+15555550177', '15555550188', '+15555550188')
);
alter table public.job_photos enable trigger job_photos_lock;
update public.profiles set full_name = 'Robin Returning'
where phone in ('15555550177', '+15555550177');
update public.profiles set full_name = 'Nova Customer'
where phone in ('15555550188', '+15555550188');
`);

const robin = people[0];
const nova = people[1];

await createRequest(url, apiKey, tokens[robin.phone], robinQuoteId, {
  ...shared(robin, "Returning customer dresser"),
  service: "delivery",
  already_paid: true,
  seller_holding: true,
  wants_item_check: true,
  stairs_dropoff: "0",
  dropoff_area: "Smyrna, 30080",
  dropoff_address: "20 Hidden Avenue",
  pricing_method: "quote",
  offer_cents: null,
  budget_min_cents: null,
  budget_max_cents: null,
});

await createRequest(url, apiKey, tokens[robin.phone], robinJunkId, {
  ...shared(robin, "Returning customer yard debris"),
  service: "junk",
  already_paid: null,
  seller_holding: null,
  wants_item_check: null,
  stairs_dropoff: null,
  dropoff_area: null,
  dropoff_address: null,
  junk_load_size: "quarter",
  junk_materials: "Yard debris",
  junk_special_items: { mattress: false, tires: false, appliances: false },
  pricing_method: "range",
  offer_cents: null,
  budget_min_cents: "4000",
  budget_max_cents: "8000",
});

await createRequest(url, apiKey, tokens[nova.phone], novaRequestId, {
  ...shared(nova, "New customer side table"),
  service: "delivery",
  already_paid: true,
  seller_holding: true,
  wants_item_check: true,
  stairs_dropoff: "0",
  dropoff_area: "Smyrna, 30080",
  dropoff_address: "20 Hidden Avenue",
  pricing_method: "fixed",
  offer_cents: "4000",
  budget_min_cents: null,
  budget_max_cents: null,
});

const count = sql(`
select count(*)
from public.jobs
where id in (
  '${robinQuoteId}',
  '${robinJunkId}',
  '${novaRequestId}'
)
and status = 'requested';
`);
if (count !== "3") throw new Error(`Expected 3 requested jobs, found ${count}.`);
console.log("Seeded 3 local requests.");
