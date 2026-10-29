import { execFileSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";

const driver = { phone: "5555550199", code: "101199", name: "Riley Driver" };
const returning = { phone: "5555550177", code: "101177", name: "Robin Returning" };
const fresh = { phone: "5555550188", code: "101188", name: "Nova Customer" };
const admin = { phone: "5555550126", code: "101126", name: "Alex Admin" };

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

test.describe.configure({ mode: "serial" });

test.beforeAll(() => {
  resetPhones([driver.phone, returning.phone, fresh.phone]);
});

test("F login copy uses the driver heading only for a known intent", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Log in or sign up" })).toBeVisible();
  await expect(page.getByText("Enter your mobile number and we'll text you a 6-digit code.")).toBeVisible();
  await expect(page.getByText("Every number gets the same message.")).toHaveCount(0);
  await expect(page.getByRole("checkbox", { name: /booking and service notifications/ })).not.toBeChecked();
  await expect(page.getByText(/We'll text you a sign-in code/)).toBeVisible();
  await expect(page.getByRole("link", { name: "SMS terms" })).toHaveAttribute("href", "/terms");
  await expect(page.getByRole("link", { name: "Privacy Policy" }).first()).toHaveAttribute("href", "/privacy");

  await page.goto("/login?intent=driver");
  await expect(page.getByRole("heading", { name: "Sign up to drive with Pickuply" })).toBeVisible();
  await expect(page.getByText("Verify your phone to start your driver application. It takes about 5 minutes.")).toBeVisible();

  await page.goto("/login?intent=admin");
  await expect(page.getByRole("heading", { name: "Log in or sign up" })).toBeVisible();

  await page.goto("/login?intent=driver&next=https://evil.example");
  await expect(page.getByRole("heading", { name: "Sign up to drive with Pickuply" })).toBeVisible();
  await expect(page.getByRole("main")).not.toContainText("evil.example");
  await page.goto("/login?next=https://evil.example/phish");
  await expect(page.getByRole("heading", { name: "Log in or sign up" })).toBeVisible();
  await expect(page.getByRole("main")).not.toContainText("evil.example");
});

test("B existing customer can apply to drive on the same account", async ({ page }) => {
  await submitRequest(page, {
    person: returning,
    service: "Pickup & Delivery",
    pricing: "quote",
    description: "Returning customer dresser",
  });
  await expect(page).toHaveURL(/\/jobs\/[0-9a-f-]+$/);
  const firstJob = page.url();
  await openAccount(page, returning.name);
  await expect(page.getByRole("link", { name: /Returning customer dresser/ })).toBeVisible();
  await signOut(page);

  await page.goto("/drive");
  await page.getByRole("link", { name: "Get started" }).first().click();
  await expect(page).toHaveURL(/intent=driver/);
  await expect(page).toHaveURL(/next=%2Fdriver%2Fonboarding|next=\/driver\/onboarding/);
  await expect(page.getByRole("heading", { name: "Sign up to drive with Pickuply" })).toBeVisible();
  await signInFromLogin(page, returning);
  await expect(page).toHaveURL(/\/driver\/onboarding$/);
  await expect(page.getByRole("button", { name: "Submit application" })).toBeVisible();
  expect(userCount(returning.phone)).toBe(1);
  await page.goto("/account");
  await expect(page.getByRole("link", { name: /Returning customer dresser/ })).toHaveAttribute("href", new URL(firstJob).pathname);
  await signOut(page);
});

test("A a new driver applies from the public drive page", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Drive with us" }).first().click();
  await expect(page).toHaveURL(/\/drive$/);
  await expect(page.getByRole("heading", { name: "Earn with your truck, van, or SUV" })).toBeVisible();
  await page.getByRole("link", { name: "Get started" }).first().click();
  await expect(page.getByRole("heading", { name: "Sign up to drive with Pickuply" })).toBeVisible();
  await signInFromLogin(page, driver);
  await expect(page).toHaveURL(/\/driver\/onboarding$/);
  await submitApplication(page, driver.name);
  await expect(page.getByText("Application submitted")).toBeVisible();
  await expect(page.getByRole("button", { name: "Submit application" })).toHaveCount(0);
});

test("C a returning applicant sees the driver home instead of a new application", async ({ page }) => {
  await page.goto("/login?next=/driver/onboarding&intent=driver");
  await signInFromLogin(page, driver);
  await expect(page).toHaveURL(/\/driver$/);
  await expect(page.getByRole("heading", { name: "Driver home" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Submit application" })).toHaveCount(0);

  localSql(
    `update public.profiles p set role = 'driver' from auth.users u where p.id = u.id and u.phone in ('1${driver.phone}', '+1${driver.phone}');`,
  );
  await page.goto("/login?next=/driver/onboarding&intent=driver");
  await expect(page).toHaveURL(/\/driver$/);
  await expect(page.getByRole("heading", { name: "Driver home" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Submit application" })).toHaveCount(0);
});

test("D a new customer signs up at the end of a request", async ({ page }) => {
  await submitRequest(page, {
    person: fresh,
    service: "Pickup & Delivery",
    pricing: "fixed",
    description: "New customer side table",
  });
  await expect(page).toHaveURL(/\/jobs\/[0-9a-f-]+$/);
  await expect(page.getByText("New customer side table")).toBeVisible();
  await openAccount(page, fresh.name);
  await expect(page.getByRole("link", { name: /New customer side table/ })).toBeVisible();
  expect(userCount(fresh.phone)).toBe(1);
});

test("E a returning customer adds a second request an admin can see", async ({ browser }) => {
  const customerContext = await browser.newContext();
  const customerPage = await customerContext.newPage();
  await customerPage.goto("/login");
  await signInFromLogin(customerPage, returning);
  await expect(customerPage).toHaveURL(/\/account$/);
  await expect(customerPage.getByRole("link", { name: /Returning customer dresser/ })).toBeVisible();
  const price = customerPage.getByRole("main").getByRole("link", { name: "Get a price" });
  await price.scrollIntoViewIfNeeded();
  await price.click();
  try {
    await customerPage.waitForURL(/\/request/, { timeout: 8_000 });
  } catch {
    await customerPage.goto("/request");
  }
  await fillRequest(customerPage, {
    service: "Junk Removal & Hauling",
    pricing: "range",
    description: "Returning customer yard debris",
    person: returning,
  });
  await customerPage.getByRole("link", { name: "View your request" }).click();
  await customerPage.waitForURL(/\/jobs\/[0-9a-f-]+$/);
  const junkPath = new URL(customerPage.url()).pathname;
  await expect(customerPage.getByText("Returning customer yard debris")).toBeVisible();
  await customerPage.goto("/account");
  await expect(customerPage.getByRole("link", { name: /Returning customer dresser/ })).toBeVisible();
  await expect(customerPage.getByRole("link", { name: /Returning customer yard debris/ })).toBeVisible();

  const adminContext = await browser.newContext();
  const adminPage = await adminContext.newPage();
  await adminPage.goto("/login");
  await signInFromLogin(adminPage, admin);
  localSql(
    `update public.profiles p set role = 'admin' from auth.users u where p.id = u.id and u.phone in ('1${admin.phone}', '+1${admin.phone}');`,
  );
  await adminPage.goto(`/admin/requests/${junkPath.split("/").pop()}`);
  await expect(adminPage.getByText("Returning customer yard debris")).toBeVisible();
  await customerContext.close();
  await adminContext.close();
});

async function signInFromLogin(page: Page, person: { phone: string; code: string; name: string }) {
  const phone = page.getByLabel("Mobile number");
  await page.waitForFunction(() => {
    const field = document.querySelector("#phone");
    return Boolean(field && Object.keys(field).some((key) => key.startsWith("__react")));
  });
  await phone.fill(person.phone);
  await expect(phone).toHaveValue(person.phone);
  await page.getByRole("button", { name: "Text me a code" }).click();
  const code = page.getByLabel("6-digit code");
  const problem = page.getByRole("main").getByRole("alert");
  await expect(code.or(problem)).toBeVisible();
  if (!(await code.isVisible())) throw new Error(await problem.innerText());
  await code.fill(person.code);
  await page.getByRole("button", { name: "Verify and continue" }).click();
  await page.waitForURL((url) => url.pathname !== "/login", { timeout: 20_000 });
  if (page.url().includes("/login/name")) {
    await page.getByLabel("First name").fill(person.name);
    const email = page.getByLabel("Email address");
    if (await email.isVisible().catch(() => false)) await email.fill(`${person.phone}@example.com`);
    await page.getByRole("checkbox", { name: /Terms and Privacy/ }).check();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.waitForURL((url) => !url.pathname.includes("/login") && !url.pathname.startsWith("/auth"));
  }
}

async function openAccount(page: Page, name: string) {
  await page.goto("/account");
  if (page.url().includes("/login/name")) {
    await page.getByLabel("First name").fill(name);
    const email = page.getByLabel("Email address");
    if (await email.isVisible().catch(() => false)) await email.fill("customer@example.com");
    await page.getByRole("checkbox", { name: /Terms and Privacy/ }).check();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.waitForURL((url) => url.pathname === "/account");
  }
  await expect(page.getByRole("heading", { name: "Your requests" })).toBeVisible();
}

async function signOut(page: Page) {
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();
}

async function submitRequest(
  page: Page,
  input: {
    person: { phone: string; code: string; name: string };
    service: string;
    pricing: "quote" | "fixed" | "range";
    description: string;
  },
) {
  await page.goto("/request");
  await fillRequest(page, input);
  await page.getByRole("button", { name: "Text me a code" }).click();
  await page.getByLabel("6-digit code").fill(input.person.code);
  await page.getByRole("button", { name: "Verify and continue" }).click();
  await expect(page.getByRole("heading", { name: "Request sent" })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("link", { name: "View your request" }).click();
  await page.waitForURL(/\/jobs\/[0-9a-f-]+$/);
}

async function fillRequest(
  page: Page,
  input: {
    person: { phone: string; code: string; name: string };
    service: string;
    pricing: "quote" | "fixed" | "range";
    description: string;
  },
) {
  await expect(page.getByRole("heading", { name: "What do you need?" })).toBeVisible();
  await page.getByRole("radio", { name: new RegExp(input.service) }).check();
  await page.getByLabel("What needs a ride?").fill(input.description);
  await page.locator("#photos").setInputFiles({ name: "photo.png", mimeType: "image/png", buffer: png });
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByLabel("Pickup street address").fill("10 Secret Street");
  await page.getByLabel("Pickup city").fill("Austell");
  await page.getByLabel("Pickup ZIP").fill("30106");
  if (input.service.startsWith("Pickup")) {
    await page.getByLabel("Drop-off street address").fill("20 Hidden Avenue");
    await page.getByLabel("Drop-off city").fill("Smyrna");
    await page.getByLabel("Drop-off ZIP").fill("30080");
  }
  await page.getByRole("radio", { name: "ASAP" }).check();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  const pricingLabel =
    input.pricing === "quote" ? "Get a quote" : input.pricing === "fixed" ? "Name your price" : "Set a budget range";
  await page.getByRole("radio", { name: new RegExp(pricingLabel) }).check();
  if (input.pricing === "fixed") await page.getByRole("textbox", { name: "Your price" }).fill("40");
  if (input.pricing === "range") {
    await page.getByRole("textbox", { name: /^Minimum/ }).fill("40");
    await page.getByRole("textbox", { name: /^Maximum/ }).fill("80");
  }
  await page.getByRole("button", { name: "Next", exact: true }).click();
  const name = page.getByLabel("Your name");
  if (await name.isVisible()) {
    await name.fill(input.person.name);
    await page.getByLabel("Phone number").fill(input.person.phone);
    await page.getByLabel("Email address").fill(`${input.person.phone}@example.com`);
    await page.getByRole("checkbox", { name: "I agree to the terms, fees, and prohibited items." }).check();
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("heading", { name: "Confirm your phone" })).toBeVisible();
    return;
  }
  await page.getByRole("checkbox", { name: "I agree to the terms, fees, and prohibited items." }).check();
  await page.getByRole("button", { name: "Send request" }).click();
  await expect(page.getByRole("heading", { name: "Request sent" })).toBeVisible();
}

async function submitApplication(page: Page, name: string) {
  const form = page.locator("form", { has: page.getByRole("button", { name: "Submit application" }) });
  await form.locator("#fullName").fill(name);
  await form.getByLabel("Street").fill("10 Test Street");
  await form.getByLabel("City").fill("Austell");
  await form.getByLabel("ZIP").fill("30106");
  await form.locator("#vehicleType").selectOption("pickup");
  await form.getByRole("radio", { name: "Light load" }).check();
  await form.locator("#licenseExpires").fill("2027-12-31");
  const photo = { name: "photo.png", mimeType: "image/png", buffer: png };
  await form.locator("#profilePhoto").setInputFiles(photo);
  await form.locator("#licensePhoto").setInputFiles(photo);
  await form.getByRole("checkbox", { name: "Pickuply can contact me about this application." }).check();
  await form.getByRole("checkbox", { name: /Pickuply Driver Terms/ }).check();
  await form.getByRole("button", { name: "Submit application" }).click();
  await page.waitForURL(/\/driver\?saved=applied/);
}

function userCount(phone: string): number {
  const raw = localSql(
    `select count(*) from auth.users where phone in ('1${phone}', '+1${phone}');`,
  ).trim();
  return Number(raw);
}

function resetPhones(phones: string[]) {
  const listed = phones.flatMap((phone) => [`'1${phone}'`, `'+1${phone}'`]).join(", ");
  localSql(`
    alter table public.job_photos disable trigger job_photos_lock;
    delete from public.job_events
    where actor_id in (select id from auth.users where phone in (${listed}))
      or job_id in (
        select id from public.jobs
        where customer_id in (select id from auth.users where phone in (${listed}))
          or assigned_driver_id in (select id from auth.users where phone in (${listed}))
      );
    update public.jobs set accepted_offer_id = null
    where customer_id in (select id from auth.users where phone in (${listed}))
      or assigned_driver_id in (select id from auth.users where phone in (${listed}));
    delete from public.job_offers
    where driver_id in (select id from auth.users where phone in (${listed}));
    delete from public.job_photos
    where job_id in (
      select id from public.jobs
      where customer_id in (select id from auth.users where phone in (${listed}))
    );
    delete from public.jobs
    where customer_id in (select id from auth.users where phone in (${listed}))
      or assigned_driver_id in (select id from auth.users where phone in (${listed}));
    delete from public.vehicles
    where driver_id in (select id from auth.users where phone in (${listed}));
    delete from public.drivers
    where profile_id in (select id from auth.users where phone in (${listed}));
    delete from public.sms_consents
    where profile_id in (select id from auth.users where phone in (${listed}));
    delete from public.notifications
    where profile_id in (select id from auth.users where phone in (${listed}));
    delete from public.audit_log
    where actor_id in (select id from auth.users where phone in (${listed}))
      or target_id in (select id from auth.users where phone in (${listed}));
    delete from public.profiles
    where id in (select id from auth.users where phone in (${listed}));
    delete from auth.users where phone in (${listed});
    alter table public.job_photos enable trigger job_photos_lock;
  `);
}

function localSql(sql: string): string {
  return execFileSync(
    "docker",
    ["exec", "-i", "supabase_db_pickuply", "psql", "-U", "postgres", "-d", "postgres", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1"],
    { encoding: "utf8", input: sql },
  );
}
