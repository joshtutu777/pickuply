import { execFileSync } from "node:child_process";
import { expect, test, type Browser, type Page } from "@playwright/test";

const driver = { phone: "5555550124", otp: "101124" };
const customer = { phone: "5555550177", otp: "101177" };
const nearZip = "31721";
const farZip = "31401";
const secretStreet = "10 Feed Lane";
const secretItem = "Walnut dresser feed check";

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
    { timeout: 30_000, waitUntil: "domcontentloaded" },
  );
  if (page.url().includes("/login/name")) {
    await page.getByLabel("First name").fill("Local Tester");
    await page.getByRole("checkbox", { name: /Terms and Privacy/ }).check();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.waitForURL((url) => !url.pathname.startsWith("/login") && !url.pathname.startsWith("/auth"));
  }
}

async function open(browser: Browser, path: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(path);
  return page;
}

async function sendGetOffers(page: Page, city: string, zip: string) {
  await page.goto("/request");
  await page.evaluate(() => localStorage.removeItem("pickuply.request-draft"));
  await page.reload();
  await page.getByRole("radio", { name: "Pickup & Delivery" }).check();
  await page.getByLabel("What needs a ride?").fill(secretItem);
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByLabel("Pickup street address").fill(secretStreet);
  await page.getByLabel("Pickup city").fill(city);
  await page.getByLabel("Pickup ZIP").fill(zip);
  await page.getByRole("button", { name: "Use this address anyway" }).click();
  await page.getByLabel("Drop-off street address").fill(secretStreet);
  await page.getByLabel("Drop-off city").fill(city);
  await page.getByLabel("Drop-off ZIP").fill(zip);
  await page.getByRole("group", { name: "Stairs at pickup" }).getByRole("radio", { name: "None" }).check();
  await page.getByRole("group", { name: "Stairs at drop-off" }).getByRole("radio", { name: "None" }).check();
  await page.getByRole("group", { name: "Is there an elevator?" }).getByRole("radio", { name: "No" }).check();
  await page.getByRole("group", { name: "I can help load" }).getByRole("radio", { name: "No" }).check();
  await page.getByRole("radio", { name: "ASAP" }).check();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByRole("radio", { name: "Get Offers" }).check();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByRole("checkbox", { name: "I agree to the terms, fees, and prohibited items." }).check();
  await page.getByRole("button", { name: "Send request" }).click();
  await expect(page.getByRole("heading", { name: "Request sent" })).toBeVisible();
  return page.getByRole("link", { name: "View your request" }).getAttribute("href");
}

test("an open driver feed shows a new request without a manual refresh", async ({ browser }, testInfo) => {
  const profileId = sql(`
    select drivers.profile_id
    from public.drivers
    join public.profiles on profiles.id = drivers.profile_id
    where right(profiles.phone, 4) = '0124' and profiles.role = 'driver'
    limit 1
  `);
  expect(profileId).toMatch(/^[0-9a-f-]{36}$/);
  const wavesBefore = sql("select waves_enabled::text from public.platform_settings");
  const coverageBefore = sql(`
    select coalesce(json_build_object(
      'cities', cities,
      'zips', zips,
      'radius', radius_miles,
      'radius_zip', radius_zip
    )::text, '')
    from public.driver_feed_filters
    where profile_id = '${profileId}'
  `);
  const activeOffers = Number(sql(`
    select count(*) from public.job_offers
    where driver_id = '${profileId}' and status = 'active' and expires_at > now()
  `));
  if (activeOffers >= 5) {
    sql(`
      update public.job_offers
      set expires_at = now() - interval '1 minute', status = 'expired'
      where driver_id = '${profileId}' and status = 'active'
    `);
  }

  sql("update public.platform_settings set waves_enabled = false");
  sql(`
    select public.apply_driver_coverage(
      '${profileId}'::uuid,
      '{}'::text[],
      array['${nearZip}']::text[],
      null,
      null
    )
  `);

  const driverPage = await open(browser, "/login?next=/driver");
  const customerPage = await open(browser, "/login?next=/request");
  try {
    await signIn(driverPage, driver);
    await driverPage.goto("/driver");
    const matched = driverPage.getByRole("region", { name: "Matched for You" });
    const georgia = driverPage.getByRole("region", { name: "All Georgia Requests" });
    await expect(matched.getByRole("heading", { name: /Matched for You/ })).toBeVisible();
    await expect(georgia.getByRole("heading", { name: /All Georgia Requests/ })).toBeVisible();
    await expect(driverPage.getByRole("switch", { name: "Show all Georgia jobs" })).toHaveCount(0);
    const nearBefore = await matched.getByText(nearZip).count();
    const farBefore = await georgia.getByText(farZip).count();

    if (await driverPage.getByRole("switch", { name: "You are Offline" }).isVisible()) {
      await driverPage.getByRole("switch", { name: "You are Offline" }).click();
    }
    await expect(driverPage.getByRole("switch", { name: "You are Online" })).toBeVisible();

    await signIn(customerPage, customer);
    const nearHref = await sendGetOffers(customerPage, "Albany", nearZip);
    expect(nearHref).toBeTruthy();
    const nearId = nearHref?.split("/").pop();
    expect(sql(`select status from public.jobs where id = '${nearId}'`)).toBe("open");

    await expect
      .poll(async () => matched.getByText(nearZip).count(), { timeout: 8_000 })
      .toBe(nearBefore + 1);
    await expect(georgia.getByText(nearZip)).toHaveCount(0);
    await expect(driverPage.getByText(secretStreet)).toHaveCount(0);
    await expect(driverPage.getByText(secretItem)).toHaveCount(0);

    const farHref = await sendGetOffers(customerPage, "Savannah", farZip);
    const farId = farHref?.split("/").pop();
    expect(sql(`select status from public.jobs where id = '${farId}'`)).toBe("open");
    await expect
      .poll(async () => georgia.getByText(farZip).count(), { timeout: 8_000 })
      .toBe(farBefore + 1);
    await expect(matched.getByText(farZip)).toHaveCount(0);
    await expect(matched.getByText(nearZip)).toHaveCount(nearBefore + 1);

    await driverPage.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await driverPage.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect(matched.getByText(nearZip)).toHaveCount(nearBefore + 1);
    await driverPage.reload();
    await expect(driverPage.getByRole("region", { name: "Matched for You" }).getByText(nearZip)).toHaveCount(nearBefore + 1);
    await expect(driverPage.getByRole("region", { name: "All Georgia Requests" }).getByText(farZip)).toHaveCount(farBefore + 1);

    const card = driverPage.getByRole("region", { name: "Matched for You" }).locator("li").filter({ hasText: nearZip }).first();
    await card.getByLabel("Offer Amount ($)").fill("40");
    await card.getByRole("button", { name: "Submit Offer" }).click();
    await expect(card.getByText("Offer submitted successfully.")).toBeVisible();
    expect(sql(`select count(*) from public.job_offers where job_id = '${nearId}' and status = 'active'`)).toBe("1");

    await customerPage.goto(nearHref ?? "/account/jobs");
    await expect(customerPage.getByRole("button", { name: "Choose this driver" })).toBeVisible();
    await driverPage.screenshot({ path: testInfo.outputPath("driver-feed.png"), fullPage: true });
  } finally {
    sql(`update public.platform_settings set waves_enabled = ${wavesBefore === "true" ? "true" : "false"}`);
    if (coverageBefore) {
      sql(`
        select public.apply_driver_coverage(
          '${profileId}'::uuid,
          coalesce((select array_agg(value) from jsonb_array_elements_text($cov$${coverageBefore}$cov$::jsonb->'cities')), '{}'::text[]),
          coalesce((select array_agg(value) from jsonb_array_elements_text($cov$${coverageBefore}$cov$::jsonb->'zips')), '{}'::text[]),
          nullif($cov$${coverageBefore}$cov$::jsonb->>'radius', '')::integer,
          nullif($cov$${coverageBefore}$cov$::jsonb->>'radius_zip', '')
        )
      `);
    }
    await driverPage.context().close();
    await customerPage.context().close();
  }
});
