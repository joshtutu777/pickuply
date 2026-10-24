import { defineConfig, devices } from "@playwright/test";
import local from "./playwright.local.config";

export default defineConfig({
  ...local,
  testMatch: /feed-refresh\.spec\.ts/,
  webServer: undefined,
  projects: [
    { name: "desktop-chrome", use: { ...devices["Desktop Chrome"] } },
    { name: "desktop-firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "mobile-chrome", use: { ...devices["Pixel 5"] } },
  ],
});
