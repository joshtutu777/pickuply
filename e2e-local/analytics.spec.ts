import { expect, test } from "@playwright/test";

test("optional tracking stays off until it is allowed, then loads once", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("dialog", { name: "Optional cookies" })).toBeVisible();
  expect(await page.locator("script[data-gtm]").count()).toBe(0);

  await page.getByRole("button", { name: "Reject optional cookies" }).click();
  await expect(page.getByRole("dialog", { name: "Optional cookies" })).toHaveCount(0);
  expect(await page.locator("script[data-gtm]").count()).toBe(0);

  await page.reload();
  await expect(page.getByRole("dialog", { name: "Optional cookies" })).toHaveCount(0);
  expect(await page.locator("script[data-gtm]").count()).toBe(0);

  await page.evaluate(() => localStorage.removeItem("pickuply-analytics-consent"));
  await page.reload();
  await page.getByRole("button", { name: "Allow optional cookies" }).click();
  await expect(page.locator("script[data-gtm='GTM-WJ6GFSH4']")).toHaveCount(1);
  expect(await page.locator("script[src*='googletagmanager.com/gtag/js']").count()).toBe(0);
  expect(await page.locator("script[src*='connect.facebook.net']").count()).toBe(0);

  const firstViews = await page.evaluate(() =>
    (window.dataLayer ?? []).filter((entry) => {
      const event = entry as { event?: string };
      return event.event === "page_view";
    }).length,
  );
  expect(firstViews).toBe(1);

  await page.getByRole("link", { name: "Blog" }).first().click();
  await expect(page).toHaveURL(/\/blog$/);
  const secondViews = await page.evaluate(() =>
    (window.dataLayer ?? []).filter((entry) => {
      const event = entry as { event?: string };
      return event.event === "page_view";
    }).length,
  );
  expect(secondViews).toBe(2);
  await expect(page.locator("script[data-gtm='GTM-WJ6GFSH4']")).toHaveCount(1);
});
