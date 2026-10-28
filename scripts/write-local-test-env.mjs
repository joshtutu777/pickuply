import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const text = execFileSync("npx supabase status -o env", { encoding: "utf8", shell: true });
const env = {};
for (const line of text.split(/\r?\n/)) {
  const eq = line.indexOf("=");
  if (eq <= 0) continue;
  const key = line.slice(0, eq);
  let value = line.slice(eq + 1);
  if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  }
  env[key] = value;
}

const picked = {};
const local = readFileSync(".env.local", "utf8");
for (const line of local.split(/\r?\n/)) {
  const eq = line.indexOf("=");
  if (eq <= 0 || line.trim().startsWith("#")) continue;
  const key = line.slice(0, eq).trim();
  let value = line.slice(eq + 1).trim();
  if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  }
  picked[key] = value;
}

const secretSource = (picked.STRIPE_TEST_SECRET_KEY ?? "").startsWith("sk_test_")
  ? picked.STRIPE_TEST_SECRET_KEY
  : (picked.STRIPE_SECRET_KEY ?? "").startsWith("sk_test_")
    ? picked.STRIPE_SECRET_KEY
    : "";
const pubSource = (picked.NEXT_PUBLIC_STRIPE_TEST_PUBLISHABLE_KEY ?? "").startsWith("pk_test_")
  ? picked.NEXT_PUBLIC_STRIPE_TEST_PUBLISHABLE_KEY
  : (picked.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? "").startsWith("pk_test_")
    ? picked.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
    : "";

const lines = [
  `NEXT_PUBLIC_SUPABASE_URL=${env.API_URL ?? "http://127.0.0.1:54321"}`,
  `NEXT_PUBLIC_SUPABASE_ANON_KEY=${env.ANON_KEY ?? ""}`,
  `SUPABASE_SERVICE_ROLE_KEY=${env.SERVICE_ROLE_KEY ?? ""}`,
  `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=${pubSource}`,
  `STRIPE_SECRET_KEY=${secretSource}`,
  `STRIPE_TEST_SECRET_KEY=${secretSource}`,
  `STRIPE_WEBHOOK_SECRET=${picked.STRIPE_WEBHOOK_SECRET ?? ""}`,
];
writeFileSync(".env.test.local", `${lines.join("\n")}\n`);
console.log(
  `wrote local test env url_local=${String(env.API_URL ?? "").includes("127.0.0.1")} anon=${Boolean(env.ANON_KEY)} stripe_test=${Boolean(secretSource)}`,
);
