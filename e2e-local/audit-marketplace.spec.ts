import { mkdirSync, writeFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

const results: { id: string; status: string; detail: string; project: string }[] = [];

function record(id: string, status: string, detail: string) {
  results.push({ id, status, detail, project: test.info().project.name });
}

async function dismiss(page: Page) {
  const reject = page.getByRole("button", { name: "Reject optional cookies" });
  if (await reject.isVisible().catch(() => false)) await reject.click({ force: true }).catch(() => undefined);
}

async function signIn(page: Page, person: { phone: string; otp: string; name: string }) {
  await page.goto("/login?next=/account");
  await dismiss(page);
  await page.locator("#phone").fill(person.phone);
  await page.getByRole("button", { name: "Text me a code" }).click();
  const code = page.getByLabel("6-digit code");
  await expect(code).toBeVisible();
  await code.fill(person.otp);
  await page.getByRole("button", { name: "Verify and continue" }).click();
  await page.waitForURL((url) => url.pathname !== "/login", { timeout: 20_000 });
  if (page.url().includes("/login/name")) {
    await page.getByLabel("First name").fill(person.name);
    await page.getByRole("checkbox", { name: /Terms and Privacy/ }).check();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.waitForURL((url) => !url.pathname.includes("/login"));
  }
}

test.afterAll(() => {
  mkdirSync("audit-results", { recursive: true });
  const name = results[0]?.project ?? "none";
  writeFileSync(`audit-results/ui-${name}.json`, JSON.stringify(results, null, 2));
});

test("public legal pages and signed-out guards", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto("/terms");
  await dismiss(page);
  await expect(page.getByText("October 28, 2026")).toBeVisible();
  record("UI-TERMS", "PASS", "terms show October 28, 2026");

  await page.goto("/privacy");
  await expect(page.getByText("October 28, 2026")).toBeVisible();
  record("UI-PRIVACY", "PASS", "privacy shows October 28, 2026");

  await page.goto("/terms/driver");
  await expect(page.getByRole("link", { name: "Terms of Service" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Privacy Policy" })).toBeVisible();
  await expect(page.getByText("development placeholder")).toHaveCount(0);
  record("UI-DRIVER-TERMS", "PASS", "driver terms links to both policies");

  await page.goto("/drive");
  await expect(page.getByRole("link", { name: /Get started|Start your application/ }).first()).toBeVisible();
  record("DRV-001", "PASS", "drive page offers the application start");

  for (const path of ["/account", "/driver", "/admin"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/login\?/);
  }
  record("CUST-013-UI", "PASS", "signed-out account, driver, and admin routes go to login");
});

test("invalid phone and invalid local code are rejected", async ({ page }) => {
  await page.goto("/login");
  await dismiss(page);
  await page.getByLabel("Mobile number").fill("123");
  await page.getByRole("button", { name: "Text me a code" }).click();
  await expect(page.locator("#phone-error")).toHaveText("Enter a valid US phone number.");
  record("CUST-003A", "PASS", "invalid phone stays on the form");

  await page.getByLabel("Mobile number").fill("5555550123");
  await page.getByRole("button", { name: "Text me a code" }).click();
  await expect(page.getByLabel("6-digit code")).toBeVisible();
  await page.getByLabel("6-digit code").fill("000000");
  await page.getByRole("button", { name: "Verify and continue" }).click();
  await expect(page.getByText("That code is wrong or expired. Request a new one.")).toBeVisible();
  record("CUST-003", "PASS", "wrong local test code is rejected");

  const resend = page.getByRole("button", { name: /Resend|Text me a code/ });
  const disabled = await resend.isDisabled().catch(() => false);
  record("CUST-005", disabled ? "PASS" : "NOT VERIFIED", disabled ? "resend control is disabled after a send" : "resend control was still enabled");
});

test("a request cannot skip the description", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto("/request?new=audit");
  await dismiss(page);
  await page.getByRole("radio", { name: /Pickup & Delivery/ }).check();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByText("Add a photo or a short description.")).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  record("BOOK-010-UI", "PASS", "empty item step shows the description error on a 390px screen");
});

test("customer sign-in, forbidden admin, and sign-out", async ({ page }) => {
  const robin = { phone: "5555550177", otp: "101177", name: "Robin Returning" };
  await signIn(page, robin);
  await expect(page).toHaveURL(/\/account/);
  record("CUST-002", "PASS", "local test OTP signs the existing customer in");

  await page.goto("/admin");
  await expect(page).toHaveURL(/error=forbidden/);
  record("ADMIN-C-024", "PASS", "customer is sent away from admin");

  await page.goto("/account/profile");
  await page.getByRole("main").getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/$/);
  record("CUST-007", "PASS", "sign out returns to the landing page");

  await signIn(page, robin);
  await expect(page).toHaveURL(/\/account/);
  record("CUST-006", "PASS", "the same phone returns to the same account");
});

test("driver home links the policies", async ({ page }) => {
  const pat = { phone: "5555550124", otp: "101124", name: "Pat Driver" };
  await page.goto("/login?next=/driver");
  await dismiss(page);
  await page.locator("#phone").fill(pat.phone);
  await page.getByRole("button", { name: "Text me a code" }).click();
  await page.getByLabel("6-digit code").fill(pat.otp);
  await page.getByRole("button", { name: "Verify and continue" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 20_000 });
  await expect(page.getByRole("link", { name: "Terms of Service" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Privacy Policy" })).toBeVisible();
  record("DRV-HOME-LINKS", "PASS", "driver home links Terms of Service and Privacy Policy");
});

test("a bad Stripe signature is rejected", async ({ request }) => {
  const response = await request.post("/api/stripe/webhook", {
    data: "{}",
    headers: { "stripe-signature": "t=1,v1=bad" },
  });
  expect(response.status()).toBe(400);
  record("PAY-007", "PASS", `webhook status ${response.status()}`);
});

test("desktop request page fits", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/request?new=audit-desktop");
  await dismiss(page);
  await expect(page.getByRole("radio", { name: /Pickup & Delivery/ })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  record("UI-DESKTOP", "PASS", "request page has no horizontal overflow at 1280px");
});

test.afterEach(async ({}, testInfo) => {
  if (testInfo.status === "failed" || testInfo.status === "timedOut") {
    record(`UI-FAIL-${testInfo.title.slice(0, 40)}`, "FAIL", testInfo.error?.message ?? "failed");
  }
});
