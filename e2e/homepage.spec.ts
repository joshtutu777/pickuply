import { expect, test } from "@playwright/test";

test("homepage loads and Get a price opens the request page", async ({
  page,
}) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Say yes to the deal. We'll do the rest.",
    }),
  ).toBeVisible();
  await expect(page.getByText("Found it. Bought it. Can't pick it up? Post it.")).toBeVisible();

  await page.getByRole("main").getByRole("link", { name: "Post a pickup" }).first().click();

  await expect(page).toHaveURL(/\/request$/);
  await expect(
    page.getByRole("heading", { level: 1, name: "What do you need?" }),
  ).toBeVisible();
});
