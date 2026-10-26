import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e-local",
  testMatch: /ui-nav-scroll\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  timeout: 60_000,
  use: {
    baseURL: "http://127.0.0.1:3001",
    headless: true,
  },
});
