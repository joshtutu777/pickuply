import { expect, test, type Page } from "@playwright/test";

const driver = { phone: "5555550124", otp: "101124" };
const customer = { phone: "5555550177", otp: "101177" };
const admin = { phone: "5555550126", otp: "101126" };

const driverLinks = [
  ["Home", /\/driver$/],
  ["Jobs", /\/driver#jobs$/],
  ["Messages", /\/driver\/messages$/],
  ["Alerts", /\/driver\/notifications$/],
  ["Profile", /\/driver\/profile$/],
] as const;

const customerLinks = [
  ["Home", /\/account$/],
  ["Requests", /\/account\/jobs$/],
  ["Messages", /\/account\/messages$/],
  ["Alerts", /\/account\/notifications$/],
  ["Profile", /\/account\/profile$/],
] as const;

const adminLinks = [
  ["Dashboard", /\/admin$/],
  ["Requests", /\/admin\/requests$/],
  ["Drivers", /\/admin\/drivers$/],
  ["Messages", /\/admin\/messages$/],
  ["Alerts", /\/admin\/notifications$/],
  ["Settings", /\/admin\/settings$/],
] as const;

async function signIn(page: Page, person: { phone: string; otp: string }) {
  await page.goto("/login");
  await page.waitForFunction(() =>
    Object.keys(document.querySelector("#phone") ?? {}).some((key) => key.startsWith("__react")),
  );
  await page.locator("#phone").fill(person.phone);
  await page.getByRole("button", { name: "Text me a code" }).click();
  const alert = page.locator("main [role=alert]");
  const code = page.getByLabel("6-digit code");
  await expect(code.or(alert)).toBeVisible();
  if (await alert.isVisible()) throw new Error(await alert.innerText());
  await code.fill(person.otp);
  await page.getByRole("button", { name: "Verify and continue" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login") && !url.pathname.startsWith("/auth"), {
    timeout: 30_000,
    waitUntil: "domcontentloaded",
  });
}

async function expectMenu(page: Page, label: string, names: readonly string[], desktop: boolean) {
  const nav = page.getByRole("navigation", { name: label });
  await expect(nav).toBeVisible();
  for (const name of names) {
    await expect(nav.getByRole("link", { name })).toBeVisible();
  }
  if (label === "Admin") return;
  if (desktop) await expect(page.locator("[data-mobile-nav]")).toBeHidden();
  else await expect(page.locator("[data-mobile-nav]")).toBeVisible();
}

test("driver, customer, and admin menus stay visible and open the right pages", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await signIn(page, driver);
  await page.goto("/driver");
  for (const width of [1280, 1024, 768]) {
    await page.setViewportSize({ width, height: 800 });
    await expectMenu(page, "Driver", driverLinks.map(([name]) => name), true);
  }
  await page.screenshot({ path: testInfo.outputPath("driver-desktop.png"), fullPage: false });
  for (const [name, url] of driverLinks) {
    await page.getByRole("navigation", { name: "Driver" }).getByRole("link", { name }).click();
    await expect(page).toHaveURL(url);
  }
  await page.goto("/driver/messages");
  await page.getByRole("link", { name: "Pickuply" }).click();
  await expect(page).toHaveURL(/\/driver$/);
  await expect(page.getByRole("navigation", { name: "Driver" })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await expectMenu(page, "Driver", driverLinks.map(([name]) => name), false);

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.context().clearCookies();
  await signIn(page, customer);
  await page.goto("/account");
  for (const width of [1280, 1024, 768]) {
    await page.setViewportSize({ width, height: 800 });
    await expectMenu(page, "Customer", customerLinks.map(([name]) => name), true);
  }
  await page.screenshot({ path: testInfo.outputPath("customer-desktop.png"), fullPage: false });
  for (const [name, url] of customerLinks) {
    await page.getByRole("navigation", { name: "Customer" }).getByRole("link", { name }).click();
    await expect(page).toHaveURL(url);
  }
  await page.goto("/account/messages");
  await page.getByRole("link", { name: "Pickuply" }).click();
  await expect(page).toHaveURL(/\/account$/);

  await page.setViewportSize({ width: 390, height: 844 });
  await expectMenu(page, "Customer", customerLinks.map(([name]) => name), false);

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.context().clearCookies();
  await signIn(page, admin);
  await page.goto("/admin");
  for (const width of [1280, 1024, 768]) {
    await page.setViewportSize({ width, height: 900 });
    await expectMenu(page, "Admin", adminLinks.map(([name]) => name), true);
  }
  await page.screenshot({ path: testInfo.outputPath("admin-desktop.png"), fullPage: false });
  for (const [name, url] of adminLinks) {
    await page.getByRole("navigation", { name: "Admin" }).getByRole("link", { name }).click();
    await expect(page).toHaveURL(url);
  }
  await page.getByRole("link", { name: "Pickuply" }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole("navigation", { name: "Admin" })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("summary").filter({ hasText: "Menu" }).click();
  await expectMenu(page, "Admin", adminLinks.map(([name]) => name), true);
});
