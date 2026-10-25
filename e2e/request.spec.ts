import { expect, test, type Page } from "@playwright/test";

test.setTimeout(90_000);

async function next(page: Page) {
  await page.getByRole("button", { name: "Next", exact: true }).click();
}

async function chooseService(page: Page, name: string) {
  await page.getByRole("radio", { name: new RegExp(name) }).check();
}

async function fillWhat(page: Page, description = "Oak dresser from Marketplace") {
  await page.getByLabel("What needs a ride?").fill(description);
  await next(page);
}

async function fillWhere(page: Page, service: "delivery" | "junk" | "free_item" | "construction") {
  await page.getByLabel("Pickup street address").fill("10 Secret Street");
  await page.getByLabel("Pickup city").fill("Austell");
  await page.getByLabel("Pickup ZIP").fill("30106");
  if (service !== "junk") {
    await page.getByLabel("Drop-off street address").fill("20 Hidden Avenue");
    await page.getByLabel("Drop-off city").fill("Smyrna");
    await page.getByLabel("Drop-off ZIP").fill("30080");
  }
  await page.getByRole("radio", { name: "ASAP" }).check();
  await next(page);
}

async function fillPrice(page: Page, pricing: "quote" | "fixed" | "range") {
  const label =
    pricing === "quote" ? "Get Offers" : pricing === "fixed" ? "Name your price" : "Set a budget range";
  await page.getByRole("radio", { name: new RegExp(label) }).check();
  if (pricing === "fixed") {
    await page.getByRole("textbox", { name: "Your price" }).fill("40");
  }
  if (pricing === "range") {
    await page.getByRole("textbox", { name: /^Minimum/ }).fill("40");
    await page.getByRole("textbox", { name: /^Maximum/ }).fill("80");
  }
  await next(page);
}

async function fillContact(page: Page) {
  await page.getByLabel("Your name").fill("Ada Lovelace");
  await page.getByLabel("Phone number").fill("4045551212");
  await page.getByLabel("Email").fill("ada@example.com");
}

async function agreeAndReachPhone(page: Page) {
  await fillContact(page);
  await page.getByRole("checkbox", { name: "I agree to the terms, fees, and prohibited items." }).check();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Confirm your phone" })).toBeVisible();
  await expect(page.getByLabel("Mobile number")).toHaveValue("4045551212");
  await expect(page.getByRole("button", { name: "Text me a code" })).toBeVisible();
  await expect(page.getByText("Demo: saved on this device only. Not sent yet.")).toHaveCount(0);
  await expect(page).toHaveURL(/\/request/);
}

test("deep link preselects junk removal", async ({ page }) => {
  await page.goto("/request?service=junk");
  await expect(page.getByRole("radio", { name: /Junk Removal & Hauling/ })).toBeChecked();
  await expect(page.getByText("We'll confirm a price after reviewing your request")).toBeVisible();
  await expect(page.getByText(/Typical price for jobs like this/)).toHaveCount(0);
});

test("required fields explain what is missing", async ({ page }) => {
  await page.goto("/request");
  await next(page);
  await expect(page.getByText("Choose a service.")).toBeVisible();
});

test("junk hides drop-off and delivery shows purchase questions", async ({ page }) => {
  await page.goto("/request?service=junk");
  await expect(page.getByRole("group", { name: "Load size" })).toBeVisible();
  await expect(page.getByRole("group", { name: "Already paid?" })).toHaveCount(0);
  await page.getByLabel("What needs a ride?").fill("Old couch");
  await next(page);
  await expect(page.getByLabel("Drop-off street address")).toHaveCount(0);
  await expect(page.getByText("Junk removal does not need a drop-off address.")).toBeVisible();

  await page.getByRole("button", { name: "Back" }).click();
  await page.getByRole("radio", { name: /Pickup & Delivery/ }).check();
  await page.getByText("Add details (optional)").click();
  await expect(page.getByRole("group", { name: "Already paid?" })).toBeVisible();
  await expect(page.getByRole("group", { name: "Load size" })).toHaveCount(0);
});

test("back and next keep what was typed", async ({ page }) => {
  await page.goto("/request");
  await chooseService(page, "Free-Item Pickups");
  await expect(page.getByRole("group", { name: "Already paid?" })).toHaveCount(0);
  await page.getByLabel("What needs a ride?").fill("Free bookshelf");
  await next(page);
  await expect(page.getByLabel("Pickup street address")).toBeVisible();
  await page.getByRole("button", { name: "Back" }).click();
  await expect(page.getByLabel("What needs a ride?")).toHaveValue("Free bookshelf");
});

test("review shows the request and requires the terms checkbox", async ({ page }) => {
  await page.goto("/request");
  await chooseService(page, "Pickup & Delivery");
  await fillWhat(page);
  await fillWhere(page, "delivery");
  await fillPrice(page, "quote");
  await expect(page.getByRole("heading", { name: "Check and send" })).toBeVisible();
  await expect(page.getByText("Oak dresser from Marketplace")).toBeVisible();
  await expect(page.getByText("Get Offers")).toBeVisible();
  await expect(page.getByRole("link", { name: "Terms, fees, and prohibited items" })).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("Agree to the terms to submit.")).toBeVisible();
  await expect(page).toHaveURL(/\/request/);
});

test("a reload restores the item but not phone, email, or street addresses", async ({ page }) => {
  await page.goto("/request");
  await chooseService(page, "Pickup & Delivery");
  await fillWhat(page);
  await page.getByLabel("Pickup street address").fill("10 Secret Street");
  await page.getByLabel("Pickup city").fill("Austell");
  await page.getByLabel("Pickup ZIP").fill("30106");
  await page.getByLabel("Drop-off street address").fill("20 Hidden Avenue");
  await page.getByLabel("Drop-off city").fill("Smyrna");
  await page.getByLabel("Drop-off ZIP").fill("30080");
  await page.getByRole("radio", { name: "ASAP" }).check();
  await next(page);
  await fillPrice(page, "quote");
  await page.getByLabel("Your name").fill("Ada Lovelace");
  await page.getByLabel("Phone number").fill("4045551212");
  await page.getByLabel("Email").fill("ada@example.com");
  await page.reload();
  await page.getByRole("button", { name: "Continue your request" }).click();
  await expect(page.getByLabel("What needs a ride?")).toHaveValue("Oak dresser from Marketplace");
  await next(page);
  await expect(page.getByLabel("Pickup street address")).toHaveValue("");
  await expect(page.getByLabel("Drop-off street address")).toHaveValue("");
  await expect(page.getByLabel("Pickup city")).toHaveValue("Austell");
  await page.getByLabel("Pickup street address").fill("10 Secret Street");
  await page.getByLabel("Drop-off street address").fill("20 Hidden Avenue");
  await page.getByRole("radio", { name: "ASAP" }).check();
  await next(page);
  await next(page);
  await expect(page.getByLabel("Phone number")).toHaveValue("");
  await expect(page.getByLabel("Email")).toHaveValue("");
  await expect(page.getByLabel("Your name")).toHaveValue("Ada Lovelace");
});

test("fixed, range, and quote pricing are validated and shown", async ({ page }) => {
  await page.goto("/request?service=delivery");
  await fillWhat(page);
  await fillWhere(page, "delivery");

  await page.getByRole("radio", { name: /Name your price/ }).check();
  await expect(page.getByRole("checkbox", { name: "Book the first driver who accepts my price" })).toHaveCount(0);
  await expect(
    page.getByText(
      "Drivers can accept your price or send a counteroffer. You choose who to book. Nothing is charged until you accept.",
    ),
  ).toBeVisible();
  await page.getByRole("textbox", { name: "Your price" }).fill("20");
  await next(page);
  await expect(page.getByText("Enter a price of at least $35.")).toBeVisible();

  await page.getByRole("textbox", { name: "Your price" }).fill("40");
  await next(page);
  await expect(page.getByText("$40")).toBeVisible();
  await expect(page.getByText("You will choose before booking.")).toBeVisible();
  await page.getByRole("button", { name: "Edit Your price" }).click();

  await page.getByRole("radio", { name: /Set a budget range/ }).check();
  await expect(page.getByRole("checkbox", { name: "Book the first driver who accepts my price" })).toHaveCount(0);
  await page.getByRole("textbox", { name: /^Minimum/ }).fill("35");
  await page.getByRole("textbox", { name: /^Maximum/ }).fill("35");
  await next(page);
  await expect(page.getByText("Maximum must be greater than the minimum.")).toBeVisible();
  await page.getByRole("textbox", { name: /^Maximum/ }).fill("90");
  await next(page);
  await expect(page.getByText("$35–$90")).toBeVisible();
  await page.getByRole("button", { name: "Edit Your price" }).click();

  await page.getByRole("radio", { name: /Get Offers/ }).check();
  await expect(
    page.getByRole("paragraph").filter({ hasText: "This is not an instant guaranteed quote." }),
  ).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Your price" })).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: /^Minimum/ })).toHaveCount(0);
  await next(page);
  await expect(page.getByText("Get Offers", { exact: true })).toBeVisible();
});

test("each service reaches phone confirmation without saving a job", async ({ page }) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => {
    localStorage.removeItem("pickuply.request-draft");
  });
  const services = [
    { name: "Pickup & Delivery", service: "delivery" as const },
    { name: "Free-Item Pickups", service: "free_item" as const },
    { name: "Junk Removal & Hauling", service: "junk" as const },
    { name: "Construction Store Deliveries", service: "construction" as const },
  ];
  for (const item of services) {
    await page.goto("/request");
    await chooseService(page, item.name);
    await fillWhat(page);
    await fillWhere(page, item.service);
    await fillPrice(page, "quote");
    await agreeAndReachPhone(page);
    const stored = await page.evaluate(() => localStorage.getItem("pickuply.request-draft") ?? "");
    expect(stored).not.toContain("10 Secret Street");
    expect(stored).not.toContain("20 Hidden Avenue");
    expect(stored).not.toContain("4045551212");
    expect(stored).not.toContain("ada@example.com");
  }
});

test("the phone layout does not scroll sideways", async ({ page }) => {
  await page.goto("/request?service=junk");
  const overflow = await page.evaluate(() => {
    const root = document.documentElement;
    return root.scrollWidth - root.clientWidth;
  });
  expect(overflow).toBeLessThanOrEqual(1);
  await expect(page.getByRole("button", { name: "Next", exact: true })).toBeVisible();
});
