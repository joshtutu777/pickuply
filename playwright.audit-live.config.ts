import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

function readEnvFile(filename: string): Record<string, string> {
  const values: Record<string, string> = {};
  try {
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
      if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      values[key] = value;
    }
  } catch {
    return values;
  }
  return values;
}

const testEnv = readEnvFile(".env.test.local");
const localEnv = readEnvFile(".env.local");
let runtime: { cronSecret?: string } = {};
try {
  runtime = JSON.parse(readFileSync(path.join(os.tmpdir(), "pickuply-audit-runtime.json"), "utf8")) as { cronSecret?: string };
} catch {
  runtime = {};
}

const stripeKey = testEnv.STRIPE_SECRET_KEY || localEnv.STRIPE_SECRET_KEY || "";
process.env.NEXT_PUBLIC_SUPABASE_URL = testEnv.NEXT_PUBLIC_SUPABASE_URL ?? "";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = testEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
process.env.STRIPE_SECRET_KEY = stripeKey;
process.env.CRON_SECRET = runtime.cronSecret ?? "";

export default defineConfig({
  testDir: "./e2e-local",
  testMatch: /audit-(continuation|marketplace)\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 420_000,
  expect: { timeout: 45_000 },
  reporter: [["line"]],
  use: {
    baseURL: "http://127.0.0.1:3011",
    headless: true,
    trace: "retain-on-failure",
    ...devices["Pixel 5"],
  },
});
