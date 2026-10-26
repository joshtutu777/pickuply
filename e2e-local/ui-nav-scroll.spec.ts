import { expect, test } from "@playwright/test";

const widths = [320, 375, 390, 430, 1280];

async function scrollTop(page: import("@playwright/test").Page) {
  return page.locator("[data-app-scroll]").evaluate((node) => node.scrollTop);
}

test("request steps open at the top on phone and desktop widths", async ({ page }) => {
  for (const width of widths) {
    await page.setViewportSize({ width, height: width >= 1280 ? 800 : 700 });
    await page.goto("/request");
    await page.evaluate(() => localStorage.clear());
    await page.goto("/request");
    await expect(page.getByRole("heading", { name: "What do you need?" })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    await page.locator("[data-app-scroll]").evaluate((node) => {
      node.scrollTop = node.scrollHeight;
    });
    await page.getByRole("radio", { name: /Pickup & Delivery/ }).check();
    await page.getByLabel("What needs a ride?").fill("A dresser from a nearby seller.");
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Where and when?" })).toBeVisible();
    expect(await scrollTop(page)).toBeLessThan(24);
    await page.getByRole("button", { name: "Back", exact: true }).click();
    await expect(page.getByRole("heading", { name: "What do you need?" })).toBeVisible();
  }
});

test("a validation error moves to the field", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 700 });
  await page.goto("/request");
  await page.locator("[data-app-scroll]").evaluate((node) => {
    node.scrollTop = node.scrollHeight;
  });
  await page.locator("form").evaluate((form) => {
    if (form instanceof HTMLFormElement) form.requestSubmit();
  });
  await expect(page.getByText("Choose a service.")).toBeVisible();
  const visible = await page.getByText("Choose a service.").evaluate((node) => {
    const rect = node.getBoundingClientRect();
    return rect.top >= 0 && rect.bottom <= window.innerHeight;
  });
  expect(visible).toBe(true);
});
