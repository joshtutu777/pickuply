import { expect, test } from "@playwright/test";

async function dismiss(page: import("@playwright/test").Page) {
  const reject = page.getByRole("button", { name: "Reject optional cookies" });
  if (await reject.isVisible().catch(() => false)) await reject.click({ force: true }).catch(() => undefined);
}

test("terms return to the same request and the upload control fits the screen", async ({ page }) => {
  for (const width of [320, 375, 390, 430, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/request?new=action-ux");
    await dismiss(page);
    await page.getByRole("radio", { name: /Pickup & Delivery/ }).check();
    await expect(page.getByRole("button", { name: /Add item photos/ })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  }

  await page.setViewportSize({ width: 390, height: 800 });
  await page.getByLabel("What needs a ride?").fill("Oak dresser from Marketplace");
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByLabel("Pickup street address").fill("10 Secret Street");
  await page.getByLabel("Pickup city").fill("Austell");
  await page.getByLabel("Pickup ZIP").fill("30106");
  await page.getByLabel("Drop-off street address").fill("20 Hidden Avenue");
  await page.getByLabel("Drop-off city").fill("Smyrna");
  await page.getByLabel("Drop-off ZIP").fill("30080");
  await page.getByRole("radio", { name: "ASAP" }).check();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByRole("radio", { name: /Get a quote/ }).check();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Check and send" })).toBeVisible();

  await page.getByRole("button", { name: "Terms, fees, and prohibited items" }).click();
  const dialog = page.getByRole("dialog", { name: "Terms of Service" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Agreement and eligibility")).toBeVisible();
  await page.goBack();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Check and send" })).toBeVisible();
  await expect(page.getByText("Oak dresser from Marketplace")).toBeVisible();
  await page.getByRole("button", { name: "Edit Where and when" }).click();
  await expect(page.getByLabel("Pickup street address")).toHaveValue("10 Secret Street");
  await expect(page.getByLabel("Drop-off street address")).toHaveValue("20 Hidden Avenue");
});
