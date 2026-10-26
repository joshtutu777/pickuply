import { execFileSync } from "node:child_process";
import { expect, test, type Browser, type Page } from "@playwright/test";

const quoteJobId = "01770000-0000-4000-8000-000000000001";
const street = "10 Secret Street";

const admin = { phone: "5555550126", otp: "101126" };
const robin = { phone: "5555550177", otp: "101177" };
const pat = { phone: "5555550124", otp: "101124", last4: "0124" };
const bea = { phone: "5555550125", otp: "101125", last4: "0125" };

function sql(statement: string): string {
  return execFileSync(
    "docker",
    ["exec", "-i", "supabase_db_pickuply", "psql", "-U", "postgres", "-d", "postgres", "-t", "-A", "-c", statement],
    { encoding: "utf8" },
  ).trim();
}

async function signIn(page: Page, person: { phone: string; otp: string }) {
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
  if (await alert.isVisible()) throw new Error(await alert.innerText());
  await code.fill(person.otp);
  await page.getByRole("button", { name: "Verify and continue" }).click();
  await page.waitForURL(
    (url) => url.pathname === "/login/name" || !url.pathname.startsWith("/login"),
    { timeout: 30_000 },
  );
  if (page.url().includes("/login/name")) {
    await page.getByLabel("First name").fill("Local Tester");
    await page.getByRole("checkbox", { name: /Terms and Privacy/ }).check();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.waitForURL((url) => !url.pathname.startsWith("/login") && !url.pathname.startsWith("/auth"));
  }
}

function quoteCard(page: Page) {
  return page
    .locator("li")
    .filter({ hasText: "Austell, 30106" })
    .filter({ hasText: "Your earnings $51" });
}

test("quote is accepted, published, and claimed by one eligible driver", async ({ browser }) => {
  execFileSync("node", ["scripts/seed-local.mjs"], { stdio: "inherit" });

  const adminPage = await open(browser, `/admin/requests/${quoteJobId}`);
  await signIn(adminPage, admin);
  await expect(adminPage).toHaveURL(new RegExp(`/admin/requests/${quoteJobId}`));
  await expect(adminPage.getByText("Austell, 30106")).toBeVisible();
  await adminPage.locator("#serviceLevel").selectOption("light");
  await adminPage.locator("#requiredVehicle").selectOption("pickup");
  await adminPage.locator("#zoneId").selectOption({ label: "West Metro" });
  await adminPage.locator("#driverPay").fill("60");
  await expect(adminPage.getByText(/Customer total \$/)).toBeVisible();
  await adminPage.locator("#preferredDate").fill("2026-10-30");
  await adminPage.locator("#timeWindow").selectOption("morning");
  await adminPage.getByRole("button", { name: "Send quote" }).click();
  await adminPage.waitForURL(/saved=1/);
  expect(adminPage.url()).not.toContain("error=");

  const customer = await open(browser, `/login?next=/jobs/${quoteJobId}`);
  await signIn(customer, robin);
  await customer.goto(`/jobs/${quoteJobId}`);
  await expect(customer.getByRole("heading", { name: "Quoted" })).toBeVisible();
  await expect(customer.getByRole("button", { name: "Accept quote" })).toBeVisible();
  await expect(
    customer.getByText("We're preparing your price. Drivers can't see this request until you accept it."),
  ).toBeVisible();
  await expect(customer.getByText("Drivers can send offers. You choose who to book.")).toHaveCount(0);

  sql(
    `update public.jobs set quote_expires_at = now() - interval '1 minute' where id = '${quoteJobId}'`,
  );
  await customer.reload();
  await customer.getByRole("button", { name: "Accept quote" }).click();
  await expect(customer.getByText("this quote has expired")).toBeVisible();
  expect(sql(`select status from public.jobs where id = '${quoteJobId}'`)).toBe("quoted");

  sql(
    `update public.jobs set quote_expires_at = now() + interval '2 hours' where id = '${quoteJobId}'`,
  );
  await customer.reload();
  await customer.getByRole("button", { name: "Accept quote" }).click();
  await expect(customer.getByRole("heading", { name: "Open for drivers" })).toBeVisible();
  await expect(
    customer.getByText("Drivers can see this request. Nothing is booked until one is assigned.", { exact: true }),
  ).toBeVisible();
  expect(sql(`select status || '|' || coalesce(assigned_driver_id::text, 'none') from public.jobs where id = '${quoteJobId}'`)).toBe(
    "open|none",
  );

  for (const driver of [pat, bea]) {
    const ready = sql(`
      select drivers.status || '|' || drivers.is_online || '|' || zones.slug
        || '|' || (drivers.license_expires >= current_date)
        || '|' || (drivers.insurance_expires >= current_date and drivers.insurance_url is not null)
        || '|' || exists (
          select 1 from public.vehicles
          where vehicles.driver_id = drivers.profile_id
            and vehicles.approved
            and vehicles.type = 'pickup'
        )
      from public.drivers
      join public.profiles on profiles.id = drivers.profile_id
      join public.zones on zones.id = drivers.zone_id
      where right(profiles.phone, 4) = '${driver.last4}'
        and profiles.role = 'driver'
        and 'delivery' = any (drivers.services)
    `);
    expect(ready).toBe("active|true|west_metro|true|true|true");
  }

  const first = await open(browser, "/driver");
  const feedResponse = first.waitForResponse(
    (response) => response.url().includes("/rpc/driver_matched_feed") && response.request().method() === "POST",
  );
  await signIn(first, pat);
  const feedPayload: unknown = await (await feedResponse).json();
  const feedRows = Array.isArray(feedPayload) ? feedPayload : [];
  for (const row of feedRows) {
    const record = row as Record<string, unknown>;
    expect(record.lat).toBeUndefined();
    expect(record.lng).toBeUndefined();
    expect(record.pickup_address).toBeUndefined();
    expect(record.home_zip).toBeUndefined();
    if (record.miles_from_you != null) {
      expect(record.miles_from_you).toBe(Math.round(Number(record.miles_from_you)));
    }
  }
  await expect(first.getByRole("switch", { name: "You are Online" })).toBeVisible();
  const firstCard = quoteCard(first);
  await expect(firstCard).toBeVisible();
  await expect(firstCard.getByText(street)).toHaveCount(0);

  const second = await open(browser, "/driver");
  await signIn(second, bea);
  await expect(second.getByRole("switch", { name: "You are Online" })).toBeVisible();
  const secondCard = quoteCard(second);
  await expect(secondCard).toBeVisible();
  await expect(secondCard.getByText(street)).toHaveCount(0);

  await firstCard.getByRole("button", { name: "Claim this job" }).click();
  await expect(first.locator(`a[href="/driver/jobs/${quoteJobId}"]`)).toBeVisible();
  await second.reload();
  await expect(secondCard).toHaveCount(0);
  expect(sql(`select right(profiles.phone, 4) from public.jobs join public.profiles on profiles.id = jobs.assigned_driver_id where jobs.id = '${quoteJobId}'`)).toBe(
    "0124",
  );

  await second.goto(`/driver/jobs/${quoteJobId}`);
  await expect(second.getByText(street)).toHaveCount(0);

  await first.goto(`/driver/jobs/${quoteJobId}`);
  await expect(first.getByText(street)).toBeVisible();
  await expect(first.getByText("We're preparing your price")).toHaveCount(0);
  await expect(first.getByText("Payment: awaiting payment")).toBeVisible();
  expect(
    sql(
      `select status || '|' || payment_status from public.jobs where id = '${quoteJobId}' and assigned_driver_id is not null`,
    ),
  ).toBe("assigned|awaiting_payment");

  await customer.goto(`/jobs/${quoteJobId}`);
  await expect(customer.getByRole("heading", { name: "Driver assigned" })).toBeVisible();
  await expect(
    customer.getByText("Confirm booking — your card is held, not charged, until your item is delivered."),
  ).toBeVisible();
});

async function open(browser: Browser, path: string, prepare?: (page: Page) => Promise<void>) {
  const context = await browser.newContext();
  const page = await context.newPage();
  if (prepare) await prepare(page);
  await page.goto(path);
  return page;
}
