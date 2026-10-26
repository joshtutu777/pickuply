import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

const testEnv = readEnvFile(".env.test.local");

function readEnvFile(filename: string): Record<string, string> {
  const filePath = path.join(process.cwd(), filename);
  const values: Record<string, string> = {};
  const text = readFileSync(filePath, "utf8");
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

for (const [key, value] of Object.entries(testEnv)) {
  process.env[key] = value;
}

function localServiceRole(): string {
  const text = execFileSync("npx supabase status -o env", { encoding: "utf8", shell: true });
  for (const line of text.split(/\r?\n/)) {
    const eq = line.indexOf("=");
    if (eq <= 0 || line.slice(0, eq) !== "SERVICE_ROLE_KEY") continue;
    return line.slice(eq + 1).replace(/^"|"$/g, "");
  }
  return "";
}

const serviceRole = localServiceRole();

const port = process.env.PLAYWRIGHT_PORT ?? "3001";

export default defineConfig({
  testDir: "./e2e-local",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  timeout: 240_000,
  expect: { timeout: 45_000 },
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: "retain-on-failure",
  },
  webServer: {
    command: `npm run dev -- --hostname 127.0.0.1 --port ${port}`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      ...process.env,
      NODE_ENV: "development",
      NEXT_PUBLIC_SUPABASE_URL: testEnv.NEXT_PUBLIC_SUPABASE_URL,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: testEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      SUPABASE_SERVICE_ROLE_KEY: serviceRole || testEnv.SUPABASE_SERVICE_ROLE_KEY,
    },
  },
  projects: [
    {
      name: "local-homepage",
      testDir: "./e2e",
      testMatch: /homepage\.spec\.ts/,
      use: { ...devices["Pixel 5"] },
    },
    {
      name: "local-request",
      testDir: "./e2e",
      testMatch: /request\.spec\.ts/,
      use: { ...devices["iPhone 13"] },
    },
    {
      name: "local-auth",
      testDir: "./e2e",
      testMatch: /auth\.spec\.ts/,
      use: { ...devices["Pixel 5"], trace: "off" },
    },
    {
      name: "local-step4",
      use: { ...devices["Pixel 5"] },
      testMatch: /step4\.spec\.ts/,
    },
    {
      name: "local-admin",
      use: { ...devices["Pixel 5"] },
      testMatch: /admin-dashboard\.spec\.ts/,
    },
    {
      name: "local-signup",
      use: { ...devices["iPhone 13"] },
      testMatch: /signup-flow\.spec\.ts/,
    },
    {
      name: "local-quote",
      use: { ...devices["iPhone 13"] },
      testMatch: /quote-workflow\.spec\.ts/,
    },
    {
      name: "local-ready",
      use: { ...devices["iPhone 13"] },
      testMatch: /quick-apply\.spec\.ts/,
    },
    {
      name: "local-mobile",
      use: { ...devices["iPhone 13"] },
      testMatch: /mobile-shell\.spec\.ts/,
    },
    {
      name: "local-profile",
      use: { ...devices["iPhone 13"] },
      testMatch: /profile-mode\.spec\.ts/,
    },
    {
      name: "local-ux",
      use: { ...devices["iPhone 13"] },
      testMatch: /transaction-ux\.spec\.ts/,
    },
    {
      name: "local-offline",
      use: { ...devices["iPhone 13"] },
      testMatch: /offline-offer\.spec\.ts/,
    },
    {
      name: "local-blog",
      use: { ...devices["Desktop Chrome"] },
      testMatch: /blog\.spec\.ts/,
    },
  ],
});
