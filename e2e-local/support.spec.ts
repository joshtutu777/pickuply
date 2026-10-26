import { execFileSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";

const customer = { phone: "5555550177", otp: "101177" };
const driver = { phone: "5555550199", otp: "101199" };
const admin = { phone: "5555550126", otp: "101126" };

function sql(statement: string) {
  execFileSync(
    "docker",
    ["exec", "-i", "supabase_db_pickuply", "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-c", statement],
    { encoding: "utf8" },
  );
}

async function signOut(page: Page) {
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.waitForURL((url) => url.pathname === "/" || url.pathname === "/login", { timeout: 20_000 });
}

async function signIn(page: Page, person: { phone: string; otp: string }, next: string) {
  sql("delete from public.rate_limit_events where scope in ('otp-phone', 'otp-ip')");
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
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

test("a support message reaches the admin inbox and stays private", async ({ page }) => {
  sql("delete from public.rate_limit_events where scope in ('otp-phone', 'otp-ip', 'support-ticket')");
  sql("delete from public.support_tickets where email = 'robin-e2e@example.com'");
  try {
    await page.goto("/contact");
    await expect(page.getByRole("heading", { name: "How can we help?" })).toBeVisible();
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(page.getByLabel("First name")).toBeVisible();
    for (const width of [320, 375, 390, 430, 1280]) {
      await page.setViewportSize({ width, height: 800 });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
      expect(overflow).toBe(true);
    }
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.getByLabel("First name").fill("Robin");
    await page.getByLabel("Email").fill("robin-e2e@example.com");
    await page.getByLabel("Topic").selectOption("payments");
    await page.getByLabel("Message").fill("The card hold is still showing.");
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(page.getByText("Message sent")).toBeVisible();
    await expect(page.getByText(/PLY-/)).toBeVisible();

    await signIn(page, customer, "/contact");
    await page.getByLabel("First name").fill("Robin");
    await page.getByLabel("Email").fill("robin-e2e@example.com");
    await page.getByLabel("Topic").selectOption("booking");
    await page.getByLabel("Message").fill("I need help with an offer.");
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(page.getByText("Your requests")).toBeVisible();
    await page.getByRole("link", { name: /Booking or offers/ }).click();
    await expect(page.getByText("I need help with an offer.")).toBeVisible();
    const ticketPath = new URL(page.url()).pathname;

    await signOut(page);
    await signIn(page, admin, "/admin/support");
    await expect(page.getByRole("link", { name: "Support" }).first()).toBeVisible();
    await page.getByRole("link", { name: /robin-e2e@example.com/ }).first().click();
    await page.getByLabel("Message").fill("We can see the hold.");
    await page.getByRole("button", { name: "Reply to customer" }).click();
    await expect(page.getByText("We can see the hold.")).toBeVisible();
    await expect(page.getByText("Saved.")).toBeVisible();
    await page.getByLabel("Message").fill("Check the payment record.");
    await page.getByRole("button", { name: "Add internal note" }).click();
    await expect(page.getByText("Internal note")).toBeVisible();
    await page.getByLabel("Status").selectOption("resolved");
    await page.getByRole("button", { name: "Update" }).click();
    await expect(page.getByText("Resolved").first()).toBeVisible();

    await signOut(page);
    await signIn(page, customer, ticketPath);
    await expect(page.getByText("We can see the hold.")).toBeVisible();
    await expect(page.getByText("Check the payment record.")).toHaveCount(0);
    await page.getByLabel("Reply").fill("Thank you.");
    await page.getByRole("button", { name: "Send reply" }).click();
    await expect(page.getByText("Reply sent.")).toBeVisible();

    await signOut(page);
    await signIn(page, driver, ticketPath);
    await expect(page.getByText(/could not be found|not found/i)).toBeVisible();
  } finally {
    sql("delete from public.support_tickets where email = 'robin-e2e@example.com'");
  }
});
