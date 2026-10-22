import { expect, test } from "@playwright/test";

test("homepage loads and Get a price opens the request page", async ({
  page,
}) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "You Find It. We Pick It Up.",
    }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Found it. Bought it. Can't pick it up? We'll bring it home.",
    ),
  ).toBeVisible();

  await page
    .getByRole("main")
    .getByRole("link", { name: "Get a price" })
    .click();

  await expect(page).toHaveURL(/\/request$/);
  await expect(
    page.getByRole("heading", { level: 1, name: "Request a pickup" }),
  ).toBeVisible();
});
