import { execFileSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";

const robin = { phone: "5555550177", otp: "101177", name: "Robin Returning" };
const pat = { phone: "5555550124", otp: "101124", name: "Pat Driver" };
const quoteJobId = "01770000-0000-4000-8000-000000000001";

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

test("sign out from Profile returns to the landing page", async ({ page }) => {
  await page.goto("/login?next=/account/profile");
  await signIn(page, robin);
  await expect(page.getByRole("heading", { name: "Robin Returning" })).toBeVisible();
  await page.screenshot({ path: "test-results/profile-mode/customer-profile.png" });
  await page.getByRole("main").getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("link", { name: "Sign in" }).first()).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
});

test("the Online switch is the first control on driver home", async ({ page }) => {
  await page.goto("/login?next=/driver");
  await signIn(page, pat);
  const availability = page.getByRole("region", { name: "Availability" });
  const toggle = availability.getByRole("button", { name: /You are O/ });
  await expect(toggle).toBeVisible();
  const heading = page.getByRole("heading", { name: "Driver home" });
  const toggleBox = await toggle.boundingBox();
  const headingBox = await heading.boundingBox();
  expect(toggleBox && headingBox && toggleBox.y < headingBox.y).toBe(true);
  await page.screenshot({ path: "test-results/profile-mode/driver-online.png" });
});

test("a customer can open Quick Apply and still has no driver permission", async ({ page }) => {
  await page.goto("/login?next=/account/profile");
  await signIn(page, robin);
  await page.getByRole("button", { name: "Become a driver" }).tap();
  await expect(page).toHaveURL(/\/driver\/onboarding/);
  await expect(page.getByRole("button", { name: "Submit application" })).toBeVisible();
  await page.screenshot({ path: "test-results/profile-mode/quick-apply.png" });
  await page.goto("/account");
  await expect(page.getByRole("heading", { name: /Hi, Robin/ })).toBeVisible();
  await page.goto("/driver/earnings");
  await expect(page).not.toHaveURL(/\/driver\/earnings$/);
});

test("a pending driver lands on the checklist, and paused or removed status is plain", async ({ page }) => {
  const robinId = sql(
    "select p.id from public.profiles p join auth.users u on u.id = p.id where u.phone in ('15555550177', '+15555550177')",
  );
  expect(robinId).toMatch(/^[0-9a-f-]{36}$/);
  const restore = () => {
    sql(`delete from public.vehicles where driver_id = '${robinId}'`);
    sql(`delete from public.drivers where profile_id = '${robinId}'`);
    sql(`update public.profiles set role = 'customer' where id = '${robinId}'`);
  };
  restore();
  try {
    sql(
      `insert into public.drivers (profile_id, status, home_city, checklist_required) values ('${robinId}', 'pending_review', 'Austell', true)`,
    );
    const size = page.viewportSize();
    expect(size && size.width <= 430).toBe(true);
    await page.goto("/login?next=/account/profile");
    await signIn(page, robin);
    const switchToDriving = page.getByRole("button", { name: "Switch to driving" });
    await expect(switchToDriving).toBeVisible();
    await expect(switchToDriving).toHaveAttribute("type", "button");
    await expect(switchToDriving.locator("xpath=ancestor::form")).toHaveCount(0);
    await switchToDriving.tap();
    await expect(page).toHaveURL(/\/driver$/);
    await expect(page).not.toHaveURL(/error=forbidden/);
    await expect(page.getByText("Application in review")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Get Ready to Drive" })).toBeVisible();
    await expect(page.getByRole("link", { name: /License/ })).toBeVisible();
    await expect(page.getByRole("link", { name: "Set up payouts" })).toHaveCount(0);
    await expect(page.getByText("You don't have access to that page.")).toHaveCount(0);
    await page.getByRole("link", { name: /Insurance/ }).click();
    await expect(page).toHaveURL(/\/driver\/ready\/insurance/);
    await expect(page.getByRole("heading", { name: "Insurance" })).toBeVisible();
    await expect(page.getByText("You don't have access to that page.")).toHaveCount(0);

    sql(
      `update public.drivers set status = 'paused', review_note = 'Paused for a manual check' where profile_id = '${robinId}'`,
    );
    sql(`update public.profiles set role = 'driver' where id = '${robinId}'`);
    await page.goto("/account/profile");
    await page.getByRole("button", { name: "Switch to driving" }).tap();
    await expect(page).toHaveURL(/\/driver$/);
    await expect(page.getByRole("heading", { name: "Driving is paused" })).toBeVisible();
    await expect(page.getByText("Paused for a manual check")).toBeVisible();
    await expect(page.getByText("You don't have access to that page.")).toHaveCount(0);

    sql(
      `update public.drivers set status = 'removed', review_note = 'Removed for a manual check' where profile_id = '${robinId}'`,
    );
    sql(`update public.profiles set role = 'customer' where id = '${robinId}'`);
    await page.goto("/account/profile");
    await page.getByRole("button", { name: "Switch to driving" }).tap();
    await expect(page).toHaveURL(/\/driver$/);
    await expect(page.getByRole("heading", { name: "Application closed" })).toBeVisible();
    await expect(page.getByText("Removed for a manual check")).toBeVisible();
    await expect(page.getByRole("link", { name: "Contact support" })).toBeVisible();
    await expect(page.getByText("You don't have access to that page.")).toHaveCount(0);
  } finally {
    restore();
  }
});

test("an approved driver can switch to the customer account", async ({ page }) => {
  await page.goto("/login?next=/driver/profile");
  await signIn(page, pat);
  await expect(page.getByRole("button", { name: "Switch to customer" })).toBeVisible();
  await page.screenshot({ path: "test-results/profile-mode/driver-profile.png" });
  await page.getByRole("button", { name: "Switch to customer" }).tap();
  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByRole("navigation", { name: "Customer" })).toBeVisible();
  await page.goto("/account/profile");
  await expect(page.getByRole("button", { name: "Switch to driving" })).toBeVisible();
  await page.getByRole("button", { name: "Sign out" }).last().click();
  await page.goto("/login");
  await signIn(page, pat);
  await expect(page).toHaveURL(/\/account$/);
  await page.goto("/driver/profile");
  await expect(page.getByRole("heading", { name: "Pat Driver" })).toBeVisible();
});

test("landing Sign up opens login", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Sign in" }).first().click();
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole("heading", { name: "Log in or sign up" })).toBeVisible();
  await page.screenshot({ path: "test-results/profile-mode/landing-signin.png" });
});

test("the reset script refuses a hosted URL", () => {
  let message = "";
  try {
    execFileSync(process.execPath, ["scripts/reset-test-user.mjs", "5555550201"], {
      encoding: "utf8",
      env: { ...process.env, NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co" },
    });
  } catch (error) {
    const failure = error as { stderr?: string };
    message = String(failure.stderr || "");
  }
  expect(message).toMatch(/not local/);
});

test("the reset script refuses a number that is not allowlisted", () => {
  let message = "";
  try {
    execFileSync(process.execPath, ["scripts/reset-test-user.mjs", "5555550999"], { encoding: "utf8" });
  } catch (error) {
    message = String((error as { stderr?: string; stdout?: string }).stderr || "");
  }
  expect(message).toMatch(/allowlist/);
});

test("driver and customer see the same four steps on a paid job", async ({ browser }) => {
  const driverId = sql(
    "select id from auth.users where phone in ('15555550124', '+15555550124', '5555550124') limit 1",
  );
  expect(driverId).toMatch(/^[0-9a-f-]{36}$/);
  sql(`
    select set_config('pickuply.job_claimed', 'yes', false);
    select set_config('pickuply.system_payment', 'yes', false);
    update public.jobs set status = 'open' where id = '${quoteJobId}' and status = 'requested';
    update public.jobs
      set status = 'assigned',
          assigned_driver_id = '${driverId}',
          payment_status = 'authorized',
          payment_due_at = now() + interval '30 minutes',
          driver_pay_cents = 6000,
          platform_fee_cents = 1000,
          service_fee_cents = 300,
          price_cents = 7300
      where id = '${quoteJobId}';
  `);
  const customerContext = await browser.newContext();
  const driverContext = await browser.newContext();
  const customer = await customerContext.newPage();
  const driver = await driverContext.newPage();
  try {
    await customer.goto("/login?next=/jobs/" + quoteJobId);
    await signIn(customer, robin);
    await expect(customer.getByLabel("Step 2 of 4: Driver Confirmed")).toBeVisible();
    await customer.screenshot({ path: "test-results/profile-mode/customer-step-2.png" });
    await driver.goto("/login?next=/driver/jobs/" + quoteJobId);
    await signIn(driver, pat);
    await expect(driver.getByLabel("Step 2 of 4: Driver Confirmed")).toBeVisible();
    await driver.getByRole("button", { name: "Start trip to pickup" }).evaluate((element) => {
      (element as HTMLButtonElement).click();
    });
    await expect(driver.getByLabel("Step 3 of 4: Pickup")).toBeVisible();
    await driver.screenshot({ path: "test-results/profile-mode/driver-step-3.png" });
    await customer.reload();
    await expect(customer.getByLabel("Step 3 of 4: Pickup")).toBeVisible();
    await driver.getByRole("button", { name: "I've arrived at pickup" }).click();
    await expect(driver.getByRole("button", { name: "Send for item check" })).toBeVisible();
  } finally {
    await customerContext.close();
    await driverContext.close();
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
