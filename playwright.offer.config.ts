import { defineConfig, devices } from "@playwright/test";
import local from "./playwright.local.config";

export default defineConfig({
  ...local,
  testMatch: /offer-counts\.spec\.ts/,
  webServer: undefined,
  projects: [
    { name: "desktop-firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "mobile-chrome", use: { ...devices["Pixel 5"] } },
  ],
});
