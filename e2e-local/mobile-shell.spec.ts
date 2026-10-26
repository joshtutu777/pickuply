import { execFileSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";

const robin = { phone: "5555550177", otp: "101177", name: "Robin Returning" };
const pat = { phone: "5555550124", otp: "101124", name: "Pat Driver" };
const bea = { phone: "5555550125", otp: "101125", name: "Bea Driver" };
const quoteJobId = "01770000-0000-4000-8000-000000000001";
const junkJobId = "01770000-0000-4000-8000-000000000002";
const street = "10 Secret Street";

function sql(statement: string): string {
  return execFileSync(
    "docker",
    ["exec", "-i", "supabase_db_pickuply", "psql", "-U", "postgres", "-d", "postgres", "-t", "-A", "-c", statement],
    { encoding: "utf8" },
  ).trim();
}

async function signIn(page: Page, person: { phone: string; otp: string; name: string }) {
  await page.waitForFunction(() =>
    Object.keys(document.querySelector("#phone") ?? {}).some((key) => key.startsWith("__react")),
  );
  const phoneInput = page.locator("#phone");
  await phoneInput.fill(person.phone);
  await expect(phoneInput).toHaveValue(person.phone);
  await page.getByRole("button", { name: "Text me a code" }).click();
  const alert = page.locator("main [role=alert]");
  const code = page.getByLabel("6-digit code");
  await expect(code.or(alert)).toBeVisible();
  if (await alert.isVisible()) {
    const text = await alert.innerText();
    if (!text.toLowerCase().includes("wait a minute")) throw new Error(text);
    await page.waitForTimeout(65_000);
    await page.reload();
    await page.waitForFunction(() =>
      Object.keys(document.querySelector("#phone") ?? {}).some((key) => key.startsWith("__react")),
    );
    await page.locator("#phone").fill(person.phone);
    await page.getByRole("button", { name: "Text me a code" }).click();
    await expect(code.or(alert)).toBeVisible();
    if (await alert.isVisible()) throw new Error(await alert.innerText());
  }
  await code.fill(person.otp);
  await page.getByRole("button", { name: "Verify and continue" }).click();
  await page.waitForURL(
    (url) => url.pathname === "/login/name" || !url.pathname.startsWith("/login"),
    { timeout: 30_000 },
  );
  if (page.url().includes("/login/name")) {
    await page.getByLabel("First name").fill(person.name);
    await page.getByRole("checkbox", { name: /Terms and Privacy/ }).check();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.waitForURL((url) => !url.pathname.startsWith("/login") && !url.pathname.startsWith("/auth"));
  }
}

async function clearOfNav(page: Page, navName: string) {
  const nav = page.getByRole("navigation", { name: navName });
  await expect(nav).toBeVisible();
  const padding = await nav.evaluate((node) => getComputedStyle(node).paddingBottom);
  expect(Number.parseFloat(padding)).toBeGreaterThanOrEqual(12);
  const scroll = page.locator("[data-app-scroll]");
  for (const top of [0, 99999]) {
    await scroll.evaluate((node, next) => {
      node.scrollTop = next;
    }, top);
    const covered = await page.evaluate((label) => {
      const bar = [...document.querySelectorAll(`nav[aria-label="${label}"]`)].find(
        (node) => node.getClientRects().length > 0,
      );
      const root = document.querySelector("[data-app-scroll]");
      if (!bar || !root) return ["missing bar"];
      const linkTops = [...bar.querySelectorAll("a")].map((link) => link.getBoundingClientRect().top);
      const limit = Math.min(bar.getBoundingClientRect().top, ...linkTops) + 1;
      const rootRect = root.getBoundingClientRect();
      const hits: string[] = [];
      for (const node of root.querySelectorAll("a, button, input, textarea, p, h1, h2, h3")) {
        const rect = node.getBoundingClientRect();
        const top = Math.max(rect.top, rootRect.top);
        const bottom = Math.min(rect.bottom, rootRect.bottom);
        if (bottom - top < 2) continue;
        if (bottom > limit && top < limit) hits.push((node.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 60));
      }
      return hits;
    }, navName);
    expect(covered, `content under the bar at scroll ${top}`).toEqual([]);
  }
}

const robinState = "test-results/robin-mobile.json";

test.beforeAll(async ({ browser }) => {
  execFileSync("node", ["scripts/seed-local.mjs"], { stdio: "inherit" });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/login?next=/account");
  await signIn(page, robin);
  await context.storageState({ path: robinState });
  await context.close();
});

test("signed-out pages keep the header and hide the app bar", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("navigation", { name: "Customer" })).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Driver" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Post a pickup" }).first()).toBeVisible();
});

test.describe("customer", () => {
  test.use({ storageState: robinState });

test("customer home, all jobs, messages, and safe area", async ({ page }) => {
  await page.goto("/account");
  await expect(page).toHaveURL(/\/account$/);
  const nav = page.getByRole("navigation", { name: "Customer" });
  await expect(nav.getByRole("link", { name: "Home" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Requests" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Messages" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Alerts" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Profile" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Returning customer dresser/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Returning customer yard debris/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Confirm booking/ })).toHaveCount(0);

  await page.goto("/account/jobs");
  await expect(page.getByRole("heading", { name: "Your requests" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Returning customer dresser/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Returning customer yard debris/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /View request/ })).toHaveCount(2);

  await page.goto("/account/messages");
  await expect(page.getByRole("heading", { name: "No conversations yet" })).toBeVisible();
  await expect(page.locator("main a")).toHaveCount(0);

  await page.goto("/account/profile");
  await expect(page.getByRole("heading", { name: robin.name })).toBeVisible();
  await expect(page.getByRole("link", { name: "Alerts" }).first()).toBeVisible();

  await page.goto("/account");
  await page.screenshot({ path: "test-results/mobile-ui/customer-home.png" });
  await clearOfNav(page, "Customer");
  await page.setViewportSize({ width: 375, height: 667 });
  await clearOfNav(page, "Customer");
  await page.screenshot({ path: "test-results/mobile-ui/bottom-nav-se.png" });
  await page.setViewportSize({ width: 393, height: 851 });
  await clearOfNav(page, "Customer");
  await page.screenshot({ path: "test-results/mobile-ui/bottom-nav-android.png" });
  await page.goto(`/jobs/${quoteJobId}`);
  await page.screenshot({ path: "test-results/mobile-ui/job-details.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/account");
  await page.screenshot({ path: "test-results/mobile-ui/bottom-nav.png" });
});

test("service deep links and the request flow hide the bar", async ({ page }) => {
  await page.goto("/request?service=junk");
  await expect(page.getByRole("navigation", { name: "Customer" })).toHaveCount(0);
  await expect(page.getByRole("radio", { name: /Junk Removal & Hauling/ })).toBeChecked();
  await expect(page.getByRole("button", { name: "Next", exact: true })).toBeVisible();
  await page.goto("/driver/onboarding");
  await expect(page.getByRole("navigation", { name: "Customer" })).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Driver" })).toHaveCount(0);
});

test("an assigned job shows the real next step, chat, and no phone link", async ({ page }) => {
  const driverId = sql(
    "select id from auth.users where phone in ('15555550124', '+15555550124', '5555550124') limit 1",
  );
  expect(driverId).toMatch(/^[0-9a-f-]{36}$/);
  sql(`
    select set_config('pickuply.job_claimed', 'yes', false);
    select set_config('pickuply.system_payment', 'yes', false);
    update public.jobs
      set status = 'open'
      where id = '${quoteJobId}' and status = 'requested';
    update public.jobs
      set status = 'assigned',
          assigned_driver_id = '${driverId}',
          payment_status = 'awaiting_payment',
          payment_due_at = now() + interval '30 minutes',
          driver_pay_cents = 6000,
          platform_fee_cents = 1000,
          service_fee_cents = 300,
          price_cents = 7300
      where id = '${quoteJobId}';
  `);

  try {
    await page.goto("/account");
    await expect(page.getByRole("link", { name: /Confirm booking/ })).toBeVisible();
    await page.goto(`/jobs/${quoteJobId}`);
    await expect(page.getByRole("heading", { name: "Driver assigned" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Chat" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Confirm booking" })).toBeVisible();
    await expect(page.locator("a[href^='tel:']")).toHaveCount(0);
    await expect(page.locator("#messages")).toBeAttached();
    await page.goto("/account/messages");
    const thread = page.getByRole("link", { name: /Returning customer dresser/ });
    await expect(thread).toHaveAttribute("href", `/jobs/${quoteJobId}#messages`);
    await thread.click();
    await expect(page).toHaveURL(new RegExp(`/jobs/${quoteJobId}`));
    await expect(page.locator("#messages")).toBeVisible();

    await page.screenshot({ path: "test-results/mobile-ui/current-job.png" });
  } finally {
    sql(`
      update public.jobs
        set status = 'requested',
            assigned_driver_id = null,
            payment_status = 'none',
            payment_due_at = null,
            driver_pay_cents = null,
            platform_fee_cents = null,
            service_fee_cents = null,
            price_cents = null
        where id = '${quoteJobId}';
    `);
  }
});

});

test("driver nav, earnings buckets, feed areas, and active job", async ({ page }) => {
  await page.goto("/login?next=/driver");
  await signIn(page, pat);
  const nav = page.getByRole("navigation", { name: "Driver" });
  await expect(nav.getByRole("link", { name: "Home" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Jobs" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Messages" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Alerts" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Profile" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Driver home" })).toBeVisible();
  await expect(page.getByLabel("Earnings")).toBeVisible();
  await page.goto("/driver#jobs");
  await expect(page.locator("#jobs")).toBeVisible();
  await expect(page.getByText(street)).toHaveCount(0);

  await page.goto("/driver/earnings");
  await expect(page.getByText("Completed earnings", { exact: true })).toBeVisible();
  await expect(page.getByText("Pending transfer", { exact: true })).toBeVisible();
  await expect(page.getByText("Transferred", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /payout/i }).first()).toBeVisible();

  await page.goto("/driver/onboarding");
  const onboardingHeading = page.getByRole("heading", { name: "Drive with Pickuply" });
  const driverHome = page.getByRole("heading", { name: "Driver home" });
  await expect(onboardingHeading.or(driverHome)).toBeVisible();
  if (await driverHome.isVisible()) {
    await expect(page.getByRole("navigation", { name: "Driver" })).toBeVisible();
  } else {
    await expect(page.getByRole("navigation", { name: "Driver" })).toHaveCount(0);
  }

  const driverId = sql(
    "select id from auth.users where phone in ('15555550124', '+15555550124', '5555550124') limit 1",
  );
  sql(`
    select set_config('pickuply.job_claimed', 'yes', false);
    select set_config('pickuply.system_payment', 'yes', false);
    update public.jobs set status = 'open' where id = '${junkJobId}' and status = 'requested';
    update public.jobs
      set status = 'assigned',
          assigned_driver_id = '${driverId}',
          payment_status = 'authorized'
      where id = '${junkJobId}';
  `);
  try {
    await page.goto("/driver");
    await expect(page.locator(`a[href="/driver/jobs/${junkJobId}"]`)).toBeVisible();
    await page.goto(`/driver/jobs/${junkJobId}`);
    await expect(page.getByText("Payment secured — you can start the trip.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Start trip to pickup" })).toBeVisible();
    await expect(page.locator("a[href^='tel:']")).toHaveCount(0);
    await expect(page.getByText(street)).toBeVisible();

    const otherContext = await page.context().browser()!.newContext();
    const other = await otherContext.newPage();
    await other.goto("/login?next=/driver");
    await signIn(other, bea);
    await other.goto(`/driver/jobs/${junkJobId}`);
    await expect(other.getByText(street)).toHaveCount(0);
    await expect(other.getByText("20 Hidden Avenue")).toHaveCount(0);
    await otherContext.close();

    await page.goto("/driver");
    await page.screenshot({ path: "test-results/mobile-ui/driver-home.png" });
    await page.screenshot({ path: "test-results/mobile-ui/available-jobs.png" });
    await page.goto(`/driver/jobs/${junkJobId}`);
    await page.screenshot({ path: "test-results/mobile-ui/active-job.png" });
    await clearOfNav(page, "Driver");
    await page.setViewportSize({ width: 375, height: 667 });
    await clearOfNav(page, "Driver");
    await page.setViewportSize({ width: 393, height: 851 });
    await clearOfNav(page, "Driver");
  } finally {
    sql(`
      update public.jobs
        set status = 'requested',
            assigned_driver_id = null,
            payment_status = 'none',
            payment_due_at = null
        where id = '${junkJobId}';
    `);
  }
});
