import { execFileSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";

const driver = { phone: "5555550199", otp: "101199", name: "Walk Driver" };
const phones = "'15555550199', '+15555550199', '5555550199'";

function sql(statement: string): string {
  return execFileSync(
    "docker",
    ["exec", "-i", "supabase_db_pickuply", "psql", "-U", "postgres", "-d", "postgres", "-t", "-A", "-c", statement],
    { encoding: "utf8" },
  ).trim();
}

async function signIn(page: Page) {
  await page.waitForFunction(() =>
    Object.keys(document.querySelector("#phone") ?? {}).some((key) => key.startsWith("__react")),
  );
  await page.locator("#phone").fill(driver.phone);
  await page.getByRole("button", { name: "Text me a code" }).click();
  const code = page.getByLabel("6-digit code");
  await expect(code).toBeVisible();
  await code.fill(driver.otp);
  await page.getByRole("button", { name: "Verify and continue" }).click();
  await page.waitForURL((url) => url.pathname !== "/login", { timeout: 20_000 });
}

test("an offline driver is warned before an offer is sent", async ({ page }) => {
  sql("delete from public.rate_limit_events where scope in ('otp-phone', 'otp-ip')");
  const before = sql(
    `select drivers.is_online::text from public.drivers join auth.users on users.id = drivers.profile_id where users.phone in (${phones})`,
  );
  sql(
    `select set_config('pickuply.driver_online', 'yes', true); update public.drivers set is_online = false where profile_id in (select id from auth.users where phone in (${phones}));`,
  );
  try {
    await page.goto("/login?next=/driver");
    await signIn(page);
    await expect(page.getByText("You are Offline.")).toBeVisible();
    await expect(page.getByRole("heading", { name: /All Georgia Requests/ })).toBeVisible();
    await expect(page.getByText("Open jobs outside your saved areas.")).toBeVisible();
    for (const width of [320, 375, 390, 430]) {
      await page.setViewportSize({ width, height: 740 });
      const overflow = await page.evaluate(() => {
        const root = document.querySelector("[data-app-scroll]") ?? document.documentElement;
        return root.scrollWidth <= root.clientWidth + 1;
      });
      expect(overflow).toBe(true);
    }
    const card = page.locator("li").filter({ has: page.getByRole("button", { name: "Submit Offer" }) }).first();
    const submit = card.getByRole("button", { name: "Submit Offer" });
    await expect(submit).toBeVisible();
    const amount = card.getByLabel(/Offer Amount|Your quote/);
    await amount.fill("55");
    await submit.click();
    const notice = card.getByRole("alert");
    await expect(notice).toContainText("You're currently offline");
    await card.getByRole("button", { name: "Go Online" }).click();
    await expect(page.getByText("You are Online.")).toBeVisible();
    await expect(page.getByRole("alert").filter({ hasText: "You're currently offline" })).toHaveCount(0);
    await expect(amount).toHaveValue("55");
    await expect(card.getByRole("button", { name: "Confirm offer" })).toHaveCount(0);
    await page.goto("/driver/profile");
    await expect(page.getByRole("heading", { name: "Notification settings" })).toBeVisible();
    await expect(page.getByText("Notification sounds")).toBeVisible();
  } finally {
    const restore = before === "true" ? "true" : "false";
    sql(
      `select set_config('pickuply.driver_online', 'yes', true); update public.drivers set is_online = ${restore} where profile_id in (select id from auth.users where phone in (${phones}));`,
    );
  }
});
