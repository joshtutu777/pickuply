import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

const testEnv = readEnvFile(".env.test.local");
const localEnv = readEnvFile(".env.local");
const status = localStatus();
const cronSecret = process.env.CRON_SECRET || randomBytes(24).toString("hex");
const listenSecret = readListenSecret();
const webhookSecret = listenSecret || localEnv.STRIPE_WEBHOOK_SECRET || "";

process.env.CRON_SECRET = cronSecret;
process.env.NEXT_PUBLIC_SUPABASE_URL = testEnv.NEXT_PUBLIC_SUPABASE_URL;
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = testEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY;
process.env.STRIPE_SECRET_KEY = localEnv.STRIPE_SECRET_KEY ?? "";
process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = localEnv.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? "";
process.env.STRIPE_WEBHOOK_SECRET = webhookSecret;
process.env.STRIPE_CONNECT_WEBHOOK_SECRET = webhookSecret;

function readEnvFile(filename: string): Record<string, string> {
  const values: Record<string, string> = {};
  const text = readFileSync(path.join(process.cwd(), filename), "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const body = trimmed.startsWith("export ") ? trimmed.slice(7).trim() : trimmed;
    const eq = body.indexOf("=");
    if (eq <= 0) continue;
    const key = body.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
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

function localStatus(): { url: string; anon: string; service: string } {
  const text = execFileSync("npx supabase status -o env", { encoding: "utf8", shell: true });
  const values = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    values.set(line.slice(0, eq), line.slice(eq + 1).replace(/^"|"$/g, ""));
  }
  return {
    url: values.get("API_URL") ?? "",
    anon: values.get("ANON_KEY") ?? "",
    service: values.get("SERVICE_ROLE_KEY") ?? "",
  };
}

function readListenSecret(): string {
  try {
    const text = readFileSync(path.join(os.tmpdir(), "pickuply-stripe-listen-secret.txt"), "utf8").trim();
    return text.startsWith("whsec_") ? text : "";
  } catch {
    return "";
  }
}

if (!status.url || !status.service) {
  throw new Error("Local Supabase is not ready for the Stripe tests.");
}
if (!process.env.STRIPE_SECRET_KEY?.startsWith("sk_test_")) {
  throw new Error("The Stripe tests need a test secret key.");
}
if (!webhookSecret.startsWith("whsec_")) {
  throw new Error("Start stripe listen before the Stripe Playwright run.");
}

export default defineConfig({
  testDir: "./e2e-local",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  timeout: 420_000,
  expect: { timeout: 45_000 },
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
  },
  webServer: {
    command: "npm run dev -- --hostname 127.0.0.1 --port 3000",
    url: "http://127.0.0.1:3000",
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      ...process.env,
      NODE_ENV: "development",
      NEXT_PUBLIC_SUPABASE_URL: testEnv.NEXT_PUBLIC_SUPABASE_URL,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: testEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      SUPABASE_SERVICE_ROLE_KEY: status.service,
      STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
      NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,
      STRIPE_WEBHOOK_SECRET: webhookSecret,
      STRIPE_CONNECT_WEBHOOK_SECRET: webhookSecret,
      CRON_SECRET: cronSecret,
    },
  },
  projects: [
    {
      name: "local-step5",
      testMatch: /step5-payments\.spec\.ts/,
    },
  ],
});
