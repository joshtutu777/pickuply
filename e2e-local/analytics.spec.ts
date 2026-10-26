import { expect, test } from "@playwright/test";

function eventCount(name: string) {
  return (window.dataLayer ?? []).filter((entry) => {
    const event = entry as { event?: string };
    return event.event === name;
  }).length;
}

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

  expect(await page.evaluate(eventCount, "page_view")).toBe(1);
  expect(await page.evaluate(() => {
    const views = (window.dataLayer ?? []).filter((entry) => (entry as { event?: string; page_path?: string }).event === "page_view");
    return (views[0] as { page_path?: string }).page_path;
  })).toBe("/");

  const pickup = page.getByRole("link", { name: "Post a pickup" }).first();
  await pickup.evaluate((link) => {
    link.addEventListener("click", (event) => event.preventDefault(), { capture: true });
  });
  await pickup.click();
  await expect(page).toHaveURL(/\/$/);
  expect(await page.evaluate(eventCount, "homepage_booking_click")).toBe(1);
  expect(await page.evaluate(eventCount, "page_view")).toBe(1);

  await page.getByRole("link", { name: "Blog" }).first().click();
  await expect(page).toHaveURL(/\/blog$/);
  expect(await page.evaluate(eventCount, "page_view")).toBe(2);
  await expect(page.locator("script[data-gtm='GTM-WJ6GFSH4']")).toHaveCount(1);

  await page.goBack();
  await expect(page).toHaveURL(/\/$/);
  expect(await page.evaluate(eventCount, "page_view")).toBe(3);

  await page.evaluate(() => {
    document.cookie = "_ga=abc; path=/";
    document.cookie = "_fbp=abc; path=/";
    document.cookie = "sb-auth-token=keep; path=/";
  });
  await page.getByRole("button", { name: "Cookie settings" }).click();
  await page.getByRole("button", { name: "Reject optional cookies" }).click();
  const cookies = await page.evaluate(() => document.cookie);
  expect(cookies).not.toContain("_ga=");
  expect(cookies).not.toContain("_fbp=");
  expect(cookies).toContain("sb-auth-token=keep");

  const viewsAfterWithdrawal = await page.evaluate(eventCount, "page_view");
  expect(viewsAfterWithdrawal).toBe(3);
  await page.getByRole("link", { name: "Drive with us" }).first().click();
  await expect(page).toHaveURL(/\/drive$/);
  expect(await page.evaluate(eventCount, "page_view")).toBe(viewsAfterWithdrawal);
  expect(await page.evaluate(eventCount, "homepage_driver_click")).toBe(0);
  await expect(page.locator("script[data-gtm='GTM-WJ6GFSH4']")).toHaveCount(1);
  expect(await page.locator("script[src*='googletagmanager.com/gtag/js']").count()).toBe(0);
  expect(await page.locator("script[src*='connect.facebook.net']").count()).toBe(0);
});
