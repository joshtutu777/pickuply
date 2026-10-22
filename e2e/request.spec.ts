import { expect, test, type Page } from "@playwright/test";

test.setTimeout(90_000);

async function next(page: Page) {
  await page.getByRole("button", { name: "Next", exact: true }).click();
}

async function chooseService(page: Page, name: string) {
  await page.getByRole("radio", { name: new RegExp(name) }).check();
  await next(page);
}

async function fillItem(
  page: Page,
  options: { service: "delivery" | "junk" | "free_item" | "construction" },
) {
  await page.getByLabel("What needs a ride?").fill("Oak dresser from Marketplace");
  await page.getByLabel("Number of pieces").fill(options.service === "construction" ? "2" : "1");
  await page.getByRole("radio", { name: "Medium" }).check();
  await page.getByLabel("Approximate item value").fill("80");
  if (options.service === "delivery") {
    await page.getByRole("group", { name: "Already paid?" }).getByRole("radio", { name: "Yes" }).check();
    await page
      .getByRole("group", { name: "Is the seller holding it?" })
      .getByRole("radio", { name: "Yes" })
      .check();
    await page
      .getByRole("group", { name: "Want a video item check before pickup?" })
      .getByRole("radio", { name: "Yes" })
      .check();
  }
  if (options.service === "junk") {
    await page.getByRole("radio", { name: "1/4 truck" }).check();
    await page.getByLabel("Materials").fill("Wood furniture");
  }
  if (options.service === "construction") {
    await page.getByLabel("Store name").fill("Home Depot");
  }
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
  await next(page);
}

async function fillAccess(page: Page) {
  await page.getByRole("group", { name: "Stairs at pickup" }).getByRole("radio", { name: "None" }).check();
  const dropoff = page.getByRole("group", { name: "Stairs at drop-off" });
  if (await dropoff.count()) {
    await dropoff.getByRole("radio", { name: "None" }).check();
  }
  await page.getByRole("group", { name: "Is there an elevator?" }).getByRole("radio", { name: "No" }).check();
  await page.getByRole("group", { name: "Can someone help load?" }).getByRole("radio", { name: "Yes" }).check();
  await page.getByRole("radio", { name: "ASAP" }).check();
  await next(page);
}

async function fillContact(page: Page, pricing: "quote" | "fixed" | "range") {
  const label =
    pricing === "quote" ? "Get a quote" : pricing === "fixed" ? "Name your price" : "Set a budget range";
  await page.getByRole("radio", { name: new RegExp(label) }).check();
  if (pricing === "fixed") {
    await page.getByRole("textbox", { name: "Your price" }).fill("40");
  }
  if (pricing === "range") {
    await page.getByRole("textbox", { name: /^Minimum/ }).fill("40");
    await page.getByRole("textbox", { name: /^Maximum/ }).fill("80");
  }
  await page.getByLabel("Your name").fill("Ada Lovelace");
  await page.getByLabel("Phone number").fill("4045551212");
  await page.getByLabel("Email").fill("ada@example.com");
  await page.getByRole("radio", { name: "Nextdoor" }).check();
  await next(page);
}

async function agreeAndSave(page: Page) {
  await page.getByRole("checkbox", { name: /late cancel fee/i }).check();
  await page.getByRole("button", { name: "Submit" }).click();
  await page.getByRole("button", { name: "Save on this device" }).click();
  await expect(page.getByText("Demo: saved on this device only. Not sent yet.")).toBeVisible();
  await expect(page.locator("li[aria-current='step']")).toHaveText("Requested");
  await expect(page.getByText("Confirmed")).toHaveCount(0);
  await expect(page.getByText("Open for drivers")).toBeVisible();
  await expect(page.getByText("It has not been quoted, booked, or assigned.")).toBeVisible();
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
  await next(page);
  await expect(page.getByRole("group", { name: "Load size" })).toBeVisible();
  await expect(page.getByRole("group", { name: "Already paid?" })).toHaveCount(0);
  await page.getByLabel("What needs a ride?").fill("Old couch");
    await page.getByRole("radio", { name: "Large", exact: true }).check();
  await page.getByLabel("Approximate item value").fill("0");
  await page.getByRole("radio", { name: "Single item" }).check();
  await page.getByLabel("Materials").fill("Fabric and wood");
  await next(page);
  await expect(page.getByLabel("Drop-off street address")).toHaveCount(0);
  await expect(page.getByText("Junk removal does not need a drop-off address.")).toBeVisible();

  await page.getByRole("button", { name: "Back" }).click();
  await page.getByRole("button", { name: "Back" }).click();
  await page.getByRole("radio", { name: /Pickup & Delivery/ }).check();
  await next(page);
  await expect(page.getByRole("group", { name: "Already paid?" })).toBeVisible();
  await expect(page.getByRole("group", { name: "Load size" })).toHaveCount(0);
});

test("back and next keep what was typed", async ({ page }) => {
  await page.goto("/request");
  await chooseService(page, "Free-Item Pickups");
  await expect(page.getByRole("group", { name: "Already paid?" })).toHaveCount(0);
  await page.getByLabel("What needs a ride?").fill("Free bookshelf");
  await next(page);
  await expect(page.getByText("Choose an approximate size.")).toBeVisible();
    await page.getByRole("radio", { name: "Large", exact: true }).check();
  await page.getByLabel("Approximate item value").fill("0");
  await next(page);
  await page.getByRole("button", { name: "Back" }).click();
  await expect(page.getByLabel("What needs a ride?")).toHaveValue("Free bookshelf");
});

test("review shows the request and requires the terms checkbox", async ({ page }) => {
  await page.goto("/request");
  await chooseService(page, "Pickup & Delivery");
  await fillItem(page, { service: "delivery" });
  await fillWhere(page, "delivery");
  await fillAccess(page);
  await fillContact(page, "quote");
  await expect(page.getByRole("heading", { name: "Review" })).toBeVisible();
  await expect(page.getByText("Oak dresser from Marketplace")).toBeVisible();
  await expect(page.getByText("Get a quote")).toBeVisible();
  await expect(page.getByText("Hazardous materials")).toBeVisible();
  await page.getByRole("button", { name: "Submit" }).click();
  await expect(page.getByText("Agree to the terms to submit.")).toBeVisible();
  await expect(page).toHaveURL(/\/request/);
});

test("a reload restores the item but not phone, email, or street addresses", async ({ page }) => {
  await page.goto("/request");
  await chooseService(page, "Pickup & Delivery");
  await fillItem(page, { service: "delivery" });
  await page.getByLabel("Pickup street address").fill("10 Secret Street");
  await page.getByLabel("Pickup city").fill("Austell");
  await page.getByLabel("Pickup ZIP").fill("30106");
  await page.getByLabel("Drop-off street address").fill("20 Hidden Avenue");
  await page.getByLabel("Drop-off city").fill("Smyrna");
  await page.getByLabel("Drop-off ZIP").fill("30080");
  await next(page);
  await fillAccess(page);
  await page.getByRole("radio", { name: /Get a quote/ }).check();
  await page.getByLabel("Your name").fill("Ada Lovelace");
  await page.getByLabel("Phone number").fill("4045551212");
  await page.getByLabel("Email").fill("ada@example.com");
  await page.reload();
  await page.getByRole("button", { name: "Continue your request" }).click();
  await next(page);
  await expect(page.getByLabel("What needs a ride?")).toHaveValue("Oak dresser from Marketplace");
  await next(page);
  await expect(page.getByLabel("Pickup street address")).toHaveValue("");
  await expect(page.getByLabel("Drop-off street address")).toHaveValue("");
  await expect(page.getByLabel("Pickup city")).toHaveValue("Austell");
  await page.getByLabel("Pickup street address").fill("10 Secret Street");
  await page.getByLabel("Drop-off street address").fill("20 Hidden Avenue");
  await next(page);
  await next(page);
  await expect(page.getByLabel("Phone number")).toHaveValue("");
  await expect(page.getByLabel("Email")).toHaveValue("");
  await expect(page.getByLabel("Your name")).toHaveValue("Ada Lovelace");
});

test("fixed, range, and quote pricing are validated and shown", async ({ page }) => {
  await page.goto("/request?service=delivery");
  await next(page);
  await fillItem(page, { service: "delivery" });
  await fillWhere(page, "delivery");
  await fillAccess(page);

  await page.getByRole("radio", { name: /Name your price/ }).check();
  await expect(page.getByRole("checkbox", { name: "Book the first driver who accepts my price" })).toHaveCount(0);
  await expect(
    page.getByText(
      "Drivers can accept your price or send a counteroffer. You choose who to book. Nothing is charged until you accept.",
    ),
  ).toBeVisible();
  await page.getByRole("textbox", { name: "Your price" }).fill("20");
  await page.getByLabel("Your name").fill("Ada Lovelace");
  await page.getByLabel("Phone number").fill("4045551212");
  await page.getByRole("radio", { name: "Facebook" }).check();
  await next(page);
  await expect(page.getByText("Enter a price of at least $35.")).toBeVisible();

  await page.getByRole("textbox", { name: "Your price" }).fill("40");
  await next(page);
  await expect(page.getByText("$40")).toBeVisible();
  await expect(page.getByText("You will choose before booking.")).toBeVisible();
  await page.getByRole("button", { name: "Edit Contact and price" }).click();

  await page.getByRole("radio", { name: /Set a budget range/ }).check();
  await expect(page.getByRole("checkbox", { name: "Book the first driver who accepts my price" })).toHaveCount(0);
  await page.getByRole("textbox", { name: /^Minimum/ }).fill("35");
  await page.getByRole("textbox", { name: /^Maximum/ }).fill("35");
  await next(page);
  await expect(page.getByText("Maximum must be greater than the minimum.")).toBeVisible();
  await page.getByRole("textbox", { name: /^Maximum/ }).fill("90");
  await next(page);
  await expect(page.getByText("$35–$90")).toBeVisible();
  await page.getByRole("button", { name: "Edit Contact and price" }).click();

  await page.getByRole("radio", { name: /Get a quote/ }).check();
  await expect(
    page.getByText("We'll review your request and send you a price. Nothing is charged until you accept."),
  ).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Your price" })).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: /^Minimum/ })).toHaveCount(0);
  await next(page);
  await expect(page.getByText("Get a quote", { exact: true })).toBeVisible();
});

test("each service can be saved on this device", async ({ page }) => {
  const services = [
    { name: "Pickup & Delivery", service: "delivery" as const },
    { name: "Free-Item Pickups", service: "free_item" as const },
    { name: "Junk Removal & Hauling", service: "junk" as const },
    { name: "Construction Store Deliveries", service: "construction" as const },
  ];
  for (const item of services) {
    await page.goto("/request");
    await chooseService(page, item.name);
    await fillItem(page, { service: item.service });
    await fillWhere(page, item.service);
    await fillAccess(page);
    await fillContact(page, "quote");
    await agreeAndSave(page);
    await expect(page.getByText(item.name).first()).toBeVisible();
    const stored = await page.evaluate(() => localStorage.getItem("pickuply.jobs") ?? "");
    expect(stored).not.toContain("10 Secret Street");
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
