import { execFileSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";

const robin = { phone: "5555550177", otp: "101177", name: "Robin Returning" };
const pat = { phone: "5555550124", otp: "101124", name: "Pat Driver" };
const customerJobId = "01770000-0000-4000-8000-000000000001";
const driverJobId = "01770000-0000-4000-8000-000000000002";
const widths = [320, 375, 390, 430];

function sql(statement: string): string {
  return execFileSync(
    "docker",
    ["exec", "-i", "supabase_db_pickuply", "psql", "-U", "postgres", "-d", "postgres", "-t", "-A", "-c", statement],
    { encoding: "utf8" },
  ).trim();
}

function setJob(id: string, extra: string) {
  sql(`select set_config('pickuply.system_payment', 'yes', true); update public.jobs set ${extra} where id = '${id}';`);
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
}

async function offersBeforeHelp(page: Page) {
  const order = await page.evaluate(() => {
    const labels = [...document.querySelectorAll("a")]
      .map((link) => link.textContent?.trim() ?? "")
      .filter((label) => label === "Offers" || label === "Help");
    return labels.indexOf("Offers") !== -1 && labels.indexOf("Offers") < labels.indexOf("Help");
  });
  expect(order).toBe(true);
}

test("compact transaction screens keep the next step in view", async ({ page }) => {
  sql("delete from public.rate_limit_events where scope in ('otp-phone', 'otp-ip')");
  const patId = sql(
    "select p.id from public.profiles p join auth.users u on u.id = p.id where u.phone in ('15555550124', '+15555550124')",
  );
  expect(patId).toMatch(/^[0-9a-f-]{36}$/);
  const previousDriver = sql(
    `select coalesce(assigned_driver_id::text, ''), status, payment_status, coalesce(dropoff_arrived_at::text, ''), coalesce(driver_pay_cents::text, ''), coalesce(platform_fee_cents::text, '') from public.jobs where id = '${driverJobId}'`,
  );
  setJob(customerJobId, "status = 'delivered', payment_status = 'authorized', customer_confirmed_at = null");
  try {
    await page.goto("/login?next=/account/profile");
    await signIn(page, robin);
    for (const width of [...widths, 1280]) {
      await page.setViewportSize({ width, height: 740 });
      await page.goto("/account/profile");
      await offersBeforeHelp(page);
    }
    await page.setViewportSize({ width: 390, height: 740 });
    await page.getByRole("link", { name: "Offers", exact: true }).first().click();
    await expect(page).toHaveURL(/\/account\/jobs/);

    for (const width of widths) {
      await page.setViewportSize({ width, height: 740 });
      await page.goto(`/jobs/${customerJobId}`);
      const status = page.getByRole("heading", { name: "Delivered" });
      const review = page.getByRole("heading", { name: "Drop-off Review" });
      await expect(status).toBeVisible();
      await expect(review).toBeVisible();
      const statusBox = await status.boundingBox();
      const reviewBox = await review.boundingBox();
      const confirm = page.getByRole("button", { name: "Confirm Delivery" });
      const confirmBox = await confirm.boundingBox();
      expect(statusBox && reviewBox && reviewBox.y > statusBox.y && reviewBox.y - statusBox.y < 180).toBe(true);
      expect(confirmBox && confirmBox.y + confirmBox.height < 740).toBe(true);
      const details = page.locator("summary", { hasText: "Job details" });
      await details.click();
      await expect(page.getByRole("heading", { name: "Request" })).toBeVisible();
      await details.click();
      await expect(page.getByRole("heading", { name: "Request" })).toBeHidden();
    }

    await page.getByRole("button", { name: "Sign out" }).click();
    await page.waitForURL((url) => url.pathname === "/");
    sql("delete from public.rate_limit_events where scope in ('otp-phone', 'otp-ip')");
    await page.goto("/login?next=/driver/jobs");
    await signIn(page, pat);
    for (const width of widths) {
      await page.setViewportSize({ width, height: 740 });
      await page.goto("/driver/jobs");
      const scrollTop = await page.locator("[data-app-scroll]").evaluate((node) => node.scrollTop);
      expect(scrollTop).toBe(0);
    }

    await page.setViewportSize({ width: 390, height: 740 });
    setJob(
      driverJobId,
      `status = 'in_transit', payment_status = 'authorized', dropoff_arrived_at = null, assigned_driver_id = '${patId}', driver_pay_cents = 4250, platform_fee_cents = 750`,
    );
    await page.goto(`/driver/jobs/${driverJobId}`);
    const arrival = page.getByRole("button", { name: "Arrived at drop-off" });
    await expect(arrival).toBeVisible();
    const arrivalBox = await arrival.boundingBox();
    expect(arrivalBox && arrivalBox.y + arrivalBox.height < 740).toBe(true);
    await expect(page.getByText("Job Amount")).toBeVisible();
    await expect(page.getByText("Your Estimated Earnings")).toBeVisible();

    setJob(driverJobId, "status = 'in_transit', payment_status = 'authorized', dropoff_arrived_at = now()");
    await page.reload();
    const delivered = page.getByRole("button", { name: "Delivered" });
    await expect(delivered).toBeVisible();
    await expect(page.locator("#proof-file")).toBeVisible();
    const deliveredBox = await delivered.boundingBox();
    const proofBox = await page.locator("#proof-file").boundingBox();
    expect(deliveredBox && deliveredBox.y + deliveredBox.height < 740).toBe(true);
    expect(proofBox && proofBox.y < 740).toBe(true);

    setJob(driverJobId, "status = 'delivered', payment_status = 'authorized'");
    await page.reload();
    const awaiting = page.getByText("Awaiting customer confirmation");
    await expect(awaiting).toBeVisible();
    await expect(awaiting).toHaveClass(/text-muted/);
    await expect(page.getByRole("button", { name: "Delivered" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Arrived at drop-off" })).toHaveCount(0);

    setJob(driverJobId, "status = 'completed', payment_status = 'captured'");
    await page.reload();
    const complete = page.locator("p", { hasText: "Delivery complete" });
    await expect(complete).toBeVisible();
    await expect(complete).toHaveClass(/bg-brand/);

    const history = page.getByText("History", { exact: true }).locator("xpath=ancestor::details[1]");
    await page.getByText("History", { exact: true }).click();
    await expect(history).toHaveJSProperty("open", true);
    await page.getByText("History", { exact: true }).click();
    await expect(history).toHaveJSProperty("open", false);
  } finally {
    setJob(customerJobId, "status = 'requested', payment_status = 'none', customer_confirmed_at = null");
    const [driverId, status, payment, arrived, driverPay, platformFee] = previousDriver.split("|");
    const driverSql = driverId ? `'${driverId}'` : "null";
    const arrivedSql = arrived ? `'${arrived}'` : "null";
    const driverPaySql = driverPay ? driverPay : "null";
    const platformFeeSql = platformFee ? platformFee : "null";
    setJob(
      driverJobId,
      `assigned_driver_id = ${driverSql}, status = '${status}', payment_status = '${payment}', dropoff_arrived_at = ${arrivedSql}, driver_pay_cents = ${driverPaySql}, platform_fee_cents = ${platformFeeSql}`,
    );
  }
});
