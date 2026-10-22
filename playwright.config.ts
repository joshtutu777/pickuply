import { readFileSync } from "node:fs";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import { defineConfig, devices } from "@playwright/test";

const silentLog = { info() {}, error() {} };
loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production", silentLog);
applyEnvFile(".env.local");

function applyEnvFile(filename: string) {
  const filePath = path.join(process.cwd(), filename);
  let text: string;
  try {
    text = readFileSync(filePath, "utf8");
  } catch {
    return;
  }
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
    if (!process.env[key]) process.env[key] = value;
  }
}

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // One worker so the iPhone WebKit project does not run out of memory.
  workers: 1,
  reporter: "list",
  expect: {
    timeout: 15_000,
  },
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "on-first-retry",
  },
  webServer: {
    command: "npm run dev -- --hostname 127.0.0.1 --port 3000",
    url: "http://127.0.0.1:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    {
      name: "mobile-chrome",
      use: { ...devices["Pixel 5"] },
      testMatch: /homepage\.spec\.ts/,
    },
    {
      name: "iphone",
      use: { ...devices["iPhone 13"] },
      testMatch: /request\.spec\.ts/,
    },
    {
      name: "auth",
      use: { ...devices["Pixel 5"], trace: "off" },
      testMatch: /auth\.spec\.ts/,
    },
  ],
});
